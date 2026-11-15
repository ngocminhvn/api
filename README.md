# ngocminh API

Backend-only Cloudflare Worker, with Keybox data ingestion from publicly shared sources.

## Layout

- `index.js`: path API router (`/keybox?action=...`) and scheduled handler.
- `public/keybox/ingest.js`: source-specific ingestion (not publicly served).
- `public/keybox/index.js`: database API responses.
- `migrations/0001_init.sql`: D1 SQLite tables and initial sources.
- `wrangler.jsonc`: D1 binding and 10-minute cron.

Cloudflare Workers bundles the JS modules in `public/` into the Worker. **Do not configure `assets.directory` to `public`**; these files implement backend logic, not static assets.

## Cron

Every 10 minutes, one source is selected in a rotating 5-source cycle, so each source is visited approximately every 50 minutes:

- Evoker: `https://evoker.qzz.io/key` (`encoded`): raw XML, Base64, hex, or common JSON encoding. Any custom codec not supported by this parser requires a separate decoder.
- Zuri: raw public XML from GitHub (`raw_xml`).
- VSTeam HyperVS/ColourVS: `https://vsteam.vn/api/profile?type=pi&branch=HyperVS` and `https://vsteam.vn/api/profile?type=pi&branch=ColourVS` (`encoded`): find JSON field `KEYBOX` (case-insensitive, including nested objects), decode conventional Base64/Hex or direct XML, and store separately per branch. Proprietary encryption or an unexpected JSON shape is recorded as an error, not silently accepted.\n- KOWX: `https://keybox.kowx712.cc/api/keyboxes` (`json_index`): select rows with `status=valid`, follow at most 3 allowlisted HTTPS download URLs per scan. Unknown JSON response shapes, dynamic download paths, or unsupported URLs are logged as errors and require adaptation after observing an actual response.

All XML records are deduplicated by SHA-256 in D1, while failed polls leave existing data untouched. **Validation currently checks only a basic XML envelope, not certificate validity or Google revocation status.** The `valid` claim from KOWX remains source-provided and cannot be considered independently verified. Files from these sources may contain private keys; only use explicitly public or authorized sources.

## Endpoints

- `/keybox?action=health`: Worker health and whether D1 is bound.
- `/keybox?action=sources`: scan times, count and errors by source.
- `/keybox?action=status`: Keybox Hub-compatible status JSON (counts, timestamps, keyboxes metadata; unverified keys stay marked as unverified).
- `/keybox?action=update`: Keybox Hub-compatible update JSON (last_updated, status, total_valid, last_looted_at).
- `/keybox?action=download`: random imported XML, or `&id=NUMBER`, or `&format=json` (Keybox Hub JSON fields: id, status, deviceId, algorithm, xml).

RKP/HW profile classification is **not implemented**; `profile=rkp` / `profile=hw` return HTTP 422 rather than a fabricated classification. Use `profile=all` or omit profile.

## Setup

Database: `api-keybox` in APAC, already created and initialized. Wrangler uses the database ID in `wrangler.jsonc`. GitHub-connected Workers Builds deploys `main` with `npx wrangler deploy`. The separate D1 initialization has already been applied; subsequent changes can use `npx wrangler d1 migrations apply api-keybox --remote`.

Test locally: `npm test`. To test cron locally with Wrangler: `npx wrangler dev --test-scheduled` and invoke the scheduled test URL supported by Wrangler. Cron times are UTC; runs may be delayed. Each VSTeam branch is tracked independently in `mode=sources`. The production cron requires a successful deployment.


## Keybox Hub JSON compatibility

The public API mirrors the JSON field names from [hzzmonetvn/keyboxhub-web](https://github.com/hzzmonetvn/keyboxhub-web) for status, update, sources, and JSON download, with the `/keybox?action=...` router. The old `/?type=keybox&mode=...` URLs still work for compatibility.

The `status` response includes `status`, `total_valid`, `total_hw_valid`, `total_rkp_valid`, `strong_count`, `device_count`, `banned_count`, `softbanned_count`, `total_keys`, `last_updated`, `last_looted_at`, and `keyboxes`. Each keybox has metadata fields matching the original project; download URLs use this project's root query router.

**Important:** This is JSON *schema* compatibility, not cryptographic validation parity. The original project evaluates certificate chains and revocation sources. This Worker does not. Unclassified records appear with `status: "unverified"`, `profile: "unknown"`, and `is_rkp: null`; confirmed valid counters remain zero rather than being fabricated. `softbanned_count` is zero because the Worker does not have softban verification. Counts and entry fields are not a guarantee of attestation validity.

Only metadata (never XML/private key material) is returned by `mode=status`. The `mode=download&format=json` endpoint intentionally returns the requested XML as with the reference project. `mode=status` lists at most 100 items per response; `&limit=50&offset=50` paginates larger datasets.


## Client-speed Pixeldrain benchmark

Open `https://api.ngocminh.io.vn/pixeldrian` **on the device whose download speed you want to measure**.
This small HTML page runs JavaScript in your browser and shows an incrementally updated JSON result in a `<pre>` block.
It measures download duration with your device's `performance.now()` clock, rather than the Worker's clock.
A rerun button starts a completely fresh scan; **there is no D1, KV, or result cache for this endpoint**.

For each of `cdn1` to `cdn32.pixeldrain.eu.cc`, the page fetches `/pixeldrian?cdn=N` on the same origin.
The Worker acts only as a streaming proxy to avoid cross-origin CORS problems; the timed connection is
**your browser → Cloudflare Worker → CDN**, so results include Cloudflare proxy overhead and do **not**
measure a direct browser → CDN link. Each probe streams exactly 10,000,000 bytes (10 decimal MB)
using sequential 4 MB, 4 MB, and 2 MB HTTP byte-range requests. CDNs that do not honor ranges
are reported as errors. The maximum network transfer for one full scan is about **320 MB**, plus overhead.
At most 3 downloads run concurrently and each has a 90-second browser timeout.

`/pixeldrian` is a browser-rendered JSON report (Content-Type: text/html), not a literal server-generated
JSON response; a server cannot determine the visitor's download time on its own.
The proxy `/pixeldrian?cdn=N` streams raw binary, not JSON. The fixed CDN list avoids open-proxy SSRF.
