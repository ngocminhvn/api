import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { handlePixeldrian, cdnUrl } from "../public/pixeldrian/index.js";
import { PAGE } from "../public/pixeldrian/page.js";
import worker from "../index.js";

test("pad single digit CDN names to 2 digits", () => {
  assert.equal(cdnUrl(1), "https://cdn01.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(3), "https://cdn03.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(23), "https://cdn23.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(32), "https://cdn32.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.throws(() => cdnUrl(33), RangeError);
});

test("HTML permits direct CDN fetch and does not request same-origin proxy", async () => {
  const response = await worker.fetch(new Request("https://api.ngocminh.io.vn/pixeldrian?utm_source=chatgpt.com"), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/html/);
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src https:\/\/\*\.pixeldrain\.eu\.cc/);
  assert.match(PAGE, /mode: "cors"/);
  assert.match(PAGE, /performance\.now\(\)/);
  assert.match(PAGE, /padStart\(2, "0"\)/);
  assert.match(PAGE, /bytes=0-/);
  assert.doesNotMatch(PAGE, /fetch\(["']\/pixeldrian\?cdn=/);
});

test("old proxy is disabled and cannot make upstream fetches", async () => {
  for (const url of ["https://api.ngocminh.io.vn/pixeldrian?cdn=3", "https://api.ngocminh.io.vn/pixeldrian?cdn=23"]) {
    const r = await handlePixeldrian(new Request(url));
    assert.equal(r.status, 410);
    assert.equal((await r.json()).error, "proxy_disabled");
  }
});

test("browser measures 10 MB directly, accepts 200 and 206, and keeps CORS failures honest", async () => {
  const script = PAGE.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "Page should have inline module script");
  const output = { textContent: "" };
  const rerun = { disabled: false, addEventListener() {} };
  const urls = [];
  const mockFetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.mode, "cors");
    assert.equal(options.headers.Range, "bytes=0-9999999");
    assert.equal(options.cache, "no-store");
    assert.ok(!url.includes("/pixeldrian?cdn="));
    const n = Number(url.match(/cdn(\d+)\./)?.[1]);
    if (n !== 3 && n !== 23) throw new TypeError("Failed to fetch");
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6_000_000));
        controller.enqueue(new Uint8Array(6_000_000)); // HTTP 200 may ignore Range; must cap at 10 MB.
        controller.close();
      }
    }), { status: n === 3 ? 200 : 206 });
  };
  vm.runInNewContext(script, {
    document: { getElementById(id) { return id === "rerun" ? rerun : output; } },
    fetch: mockFetch,
    AbortController,
    setTimeout,
    clearTimeout,
    performance,
    Date,
    JSON,
  });
  let state;
  for (let i = 0; i < 150; i++) {
    state = JSON.parse(output.textContent);
    if (state.status === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(state.status, "complete");
  assert.equal(state.checked_count, 32);
  assert.equal(state.success_count, 2);
  assert.equal(state.results[2].url, cdnUrl(3));
  assert.equal(state.results[22].url, cdnUrl(23));
  assert.equal(state.results[2].bytes_downloaded, 10000000);
  assert.equal(state.results[22].bytes_downloaded, 10000000);
  assert.equal(state.results[2].http_status, 200);
  assert.equal(state.results[22].http_status, 206);
  assert.ok(state.results[22].speed_Mbps > 0);
  assert.equal(state.results[0].status, "error");
  assert.equal(state.results[0].speed_MBps, null);
  assert.equal(urls.length, 32);
});
