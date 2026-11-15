# ngocminh API

Backend-only Cloudflare Worker, with Keybox data ingestion from publicly shared sources.

## Layout

- `index.js`: root API router (`?type=keybox&mode=...`) and scheduled handler.
- `public/keybox/ingest.js`: source-specific ingestion (not publicly served).
- `public/keybox/index.js`: database API responses.
- `migrations/0001_init.sql`: D1 SQLite tables and initial sources.
- `wrangler.jsonc`: D1 binding and 10-minute cron.

Cloudflare Workers bundles the JS modules in `public/` into the Worker. **Do not configure `assets.directory` to `public`**; these files implement backend logic, not static assets.

## Cron

Every 10 minutes, one source is selected in a rotating 3-source cycle, so each source is visited approximately every 30 minutes:

- Evoker: `https://evoker.qzz.io/key` (`encoded`): raw XML, Base64, hex, or common JSON encoding. Any custom codec not supported by this parser requires a separate decoder.
- Zuri: raw public XML from GitHub (`raw_xml`).
- KOWX: `https://keybox.kowx712.cc/api/keyboxes` (`json_index`): select rows with `status=valid`, follow at most 3 allowlisted HTTPS download URLs per scan. Unknown JSON response shapes, dynamic download paths, or unsupported URLs are logged as errors and require adaptation after observing an actual response.

All XML records are deduplicated by SHA-256 in D1, while failed polls leave existing data untouched. **Validation currently checks only a basic XML envelope, not certificate validity or Google revocation status.** The `valid` claim from KOWX remains source-provided and cannot be considered independently verified. Files from these sources may contain private keys; only use explicitly public or authorized sources.

## Endpoints

- `/?type=keybox&mode=health`: Worker health and whether D1 is bound.
- `/?type=keybox&mode=sources`: scan times, count and errors by source.
- `/?type=keybox&mode=status`: unverified inventory summary.
- `/?type=keybox&mode=update`: latest attempted source check.
- `/?type=keybox&mode=download`: random imported XML, or `&id=NUMBER`, or `&format=json`.

RKP/HW profile classification is **not implemented**; `profile=rkp` / `profile=hw` return HTTP 422 rather than a fabricated classification. Use `profile=all` or omit profile.

## Setup

Database: `api-keybox` in APAC, already created and initialized. Wrangler uses the database ID in `wrangler.jsonc`. GitHub-connected Workers Builds deploys `main` with `npx wrangler deploy`. The separate D1 initialization has already been applied; subsequent changes can use `npx wrangler d1 migrations apply api-keybox --remote`.

Test locally: `npm test`. To test cron locally with Wrangler: `npx wrangler dev --test-scheduled` and invoke the scheduled test URL supported by Wrangler. Cron times are UTC; runs may be delayed. The production cron requires a successful deployment.
