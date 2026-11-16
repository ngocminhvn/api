# ngocminh API

Backend-only Cloudflare Worker, with Keybox data ingestion from publicly shared sources.

## Layout

- `index.js`: path API router (`/keybox?action=...`) and scheduled handler.
- `public/keybox/ingest.js`: source-specific ingestion (not publicly served).
- `public/keybox/index.js`: database API responses.
- `migrations/0001_init.sql`: D1 SQLite tables and initial sources.
- `wrangler.jsonc`: D1 binding and five daily cron schedules.

Cloudflare Workers bundles the JS modules in `public/` into the Worker. **Do not configure `assets.directory` to `public`**; these files implement backend logic, not static assets.

## Cron

Each source is scanned **once per day** on five separate Cloudflare Cron Triggers to reduce the per-invocation CPU cost. All times below are in Vietnam (Asia/Ho_Chi_Minh, UTC+7):

| Time | Source | UTC cron |
| --- | --- | --- |
| 07:00 | Evoker | `0 0 * * *` |
| 07:10 | Zuri GitHub | `10 0 * * *` |
| 07:20 | KOWX | `20 0 * * *` |
| 07:30 | VSTeam HyperVS | `30 0 * * *` |
| 07:40 | VSTeam ColourVS | `40 0 * * *` |

The Worker uses `event.cron` to select the correct source. These five schedules use all five Cron Trigger slots of Workers Free. Propagation may take up to 15 minutes. Individual source errors do not erase previous keyboxes.

Sources:

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


## Pixeldrain CDN speed test (Fedora local, JSON viewer)

Pixeldrain's `hotlink_detected` 403 protection blocks scripted cross-origin
downloads from the `/pixeldrian` web page, even when the CDN works from
the user's own Fedora command line. A browser cannot read timings for requests
blocked by the CDN or CORS, and proxy timing does not measure the Fedora path.

Use the provided **local test** instead. On Fedora, with `python3` and `curl`:

```bash
curl -fsSL https://raw.githubusercontent.com/ngocminhvn/api/main/scripts/pixeldrian_speed.py -o /tmp/pixeldrian_speed.py
python3 /tmp/pixeldrian_speed.py
```

The Python script makes direct `curl` requests to fixed URLs
`https://cdn01.pixeldrain.eu.cc/api/file/S4NGwF6i` through `cdn32`.
Each request sends `Range: bytes=0-9999999`. If a CDN ignores Range
and responds HTTP 200 with the entire multi-GB file, Python stops reading the
subprocess's stdout when exactly 10,000,000 bytes have been received and
terminates the subprocess. It does not follow HTTP redirects or attempt
to circumvent hotlink protection. HTTP errors, DNS errors and downloads
that transfer fewer than 10 MB are reported as errors with null speed.
Runs are sequential by default so CDNs do not share local download bandwidth;
`--jobs 2` or `--jobs 3` is optional but makes rankings less comparable.

By default, it creates `~/Downloads/pixeldrian-results.json`.
Open `https://api.ngocminh.io.vn/pixeldrian` and select that JSON file.
The page displays the ranking of **successfully completed** 10 MB tests,
a table of errors, and the raw JSON. All import and sorting happens in the
browser using the File API; nothing is uploaded or saved to D1/KV.

The web endpoint's old `?cdn=N` streaming proxy has been disabled (HTTP 410).
This separates trustworthy client-local download measurements from
Cloudflare Worker network paths. Read the script before running it;
a full successful pass can download about **320 MB** of traffic.
