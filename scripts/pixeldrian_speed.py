#!/usr/bin/env python3
"""Measure the first 10 decimal MB of 32 fixed Pixeldrain CDN URLs from Fedora.

Requires only Python 3 and curl. Does not bypass hotlink restrictions,
follow redirects, upload results, or involve Cloudflare Worker.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

FILE_ID = "S4NGwF6i"
TARGET_BYTES = 10_000_000
CDN_NUMBERS = tuple(range(1, 33))


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def cdn_url(number: int) -> str:
    if number not in CDN_NUMBERS:
        raise ValueError("CDN index must be between 1 and 32")
    return f"https://cdn{number:02d}.pixeldrain.eu.cc/api/file/{FILE_ID}"


def response_status(headers: str) -> int | None:
    # HTTP status can appear more than once (e.g. HTTP proxy CONNECT).
    statuses = re.findall(r"(?im)^HTTP/\S+\s+(\d{3})(?:\s|$)", headers)
    return int(statuses[-1]) if statuses else None


def measure(number: int, timeout: int, curl: str = "curl") -> dict:
    url = cdn_url(number)
    started = time.perf_counter()
    count = 0
    error = None
    exit_code = None
    with tempfile.TemporaryDirectory(prefix="pixeldrian-") as tmp:
        headers_path = Path(tmp) / "headers.txt"
        stderr_path = Path(tmp) / "curl-error.txt"
        cmd = [
            curl, "--silent", "--show-error", "--http1.1",
            "--connect-timeout", "10", "--max-time", str(timeout),
            "--range", f"0-{TARGET_BYTES - 1}",
            "--dump-header", str(headers_path),
            "--output", "-",  # Stream into Python, never create a 4 GB file.
            "--proto", "=https",
            url,
        ]
        with stderr_path.open("wb") as err_file:
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err_file)
            except OSError as exc:
                proc = None
                error = f"curl_start_failed: {exc}"
            if proc is not None:
                try:
                    assert proc.stdout is not None
                    with proc.stdout:
                        while count < TARGET_BYTES:
                            chunk = proc.stdout.read(min(64 * 1024, TARGET_BYTES - count))
                            if not chunk:
                                break
                            count += len(chunk)
                    # When a CDN ignores Range (HTTP 200) and sends the full
                    # file, terminate curl after receiving just 10 MB.
                    if count >= TARGET_BYTES and proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                    exit_code = proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                    error = "timeout"
                finally:
                    if proc.poll() is None:
                        proc.kill()
                        proc.wait()
        elapsed = max(0.001, time.perf_counter() - started)
        http = response_status(headers_path.read_text(errors="replace") if headers_path.exists() else "")
        stderr = stderr_path.read_text(errors="replace").strip() if stderr_path.exists() else ""

    # Some CDNs return 403 hotlink_detected, 429, or a redirect. Never label
    # those responses as a successful speed test.
    ok = count == TARGET_BYTES and http in (200, 206)
    if not ok and error is None:
        if http not in (200, 206) and http is not None:
            error = f"http_{http}"
        elif count < TARGET_BYTES:
            error = "incomplete_10mb"
        else:
            error = "invalid_http_status"
        if stderr:
            error += ": " + stderr[:120]
    seconds = elapsed
    return {
        "cdn": number,
        "url": url,
        "status": "ok" if ok else "error",
        "http_status": http,
        "bytes_downloaded": count,
        "duration_ms": round(seconds * 1000),
        "speed_MBps": round(count / 1_000_000 / seconds, 3) if ok else None,
        "speed_Mbps": round(count * 8 / 1_000_000 / seconds, 3) if ok else None,
        "error": error,
        "method": "fedora_curl_direct",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Test CDN01–CDN32 directly from this device, 10 MB per CDN.")
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads" / "pixeldrian-results.json",
                        help="Output JSON path (default: ~/Downloads/pixeldrian-results.json)")
    parser.add_argument("--timeout", type=int, default=30, help="Per-CDN timeout in seconds (5–120)")
    parser.add_argument("--jobs", type=int, default=1, help="Parallel downloads (1–3); 1 recommended for fair speed comparison")
    args = parser.parse_args()
    if not 5 <= args.timeout <= 120 or not 1 <= args.jobs <= 3:
        parser.error("timeout must be 5–120 and jobs must be 1–3")
    if not shutil.which("curl"):
        parser.error("curl not found; on Fedora: sudo dnf install curl")

    print("Measuring 32 CDNs from this Fedora device; max 10 MB/CDN.", file=sys.stderr)
    print("CDNs returning 403/hotlink_detected are marked as errors.", file=sys.stderr)
    started_at = iso_now()
    started = time.perf_counter()
    results = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        tasks = {pool.submit(measure, number, args.timeout): number for number in CDN_NUMBERS}
        for task in as_completed(tasks):
            n = tasks[task]
            try:
                item = task.result()
            except Exception as exc:
                item = {
                    "cdn": n, "url": cdn_url(n), "status": "error",
                    "http_status": None, "bytes_downloaded": 0, "duration_ms": 0,
                    "speed_MBps": None, "speed_Mbps": None,
                    "error": f"measurement_failed: {str(exc)[:120]}",
                    "method": "fedora_curl_direct",
                }
            results.append(item)
            label = f"{item['speed_MBps']} MB/s" if item["status"] == "ok" else item["error"]
            print(f"CDN{n:02d}: {label}", file=sys.stderr, flush=True)

    results.sort(key=lambda r: r["cdn"])
    successful = sorted((r for r in results if r["status"] == "ok"), key=lambda r: r["speed_Mbps"], reverse=True)
    report = {
        "service": "pixeldrian",
        "measured_from": "fedora_curl_direct",
        "file_id": FILE_ID,
        "requested_bytes_per_cdn": TARGET_BYTES,
        "cdn_count": len(CDN_NUMBERS),
        "started_at": started_at,
        "finished_at": iso_now(),
        "total_elapsed_ms": round((time.perf_counter() - started) * 1000),
        "checked_count": len(results),
        "success_count": len(successful),
        "status": "complete",
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved: {args.output}", file=sys.stderr)
    if successful:
        fastest = successful[0]
        print(f"Fastest: CDN{fastest['cdn']:02d} — {fastest['speed_MBps']} MB/s ({fastest['speed_Mbps']} Mbps)", file=sys.stderr)
    print("Open https://api.ngocminh.io.vn/pixeldrian and import the JSON file.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
