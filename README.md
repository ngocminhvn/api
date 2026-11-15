# ngocminh API

Backend-only Cloudflare Worker for [api.ngocminh.io.vn](https://api.ngocminh.io.vn/). No React, Next.js, HTML, Express or local Node server is required.

## Structure

```text
index.js                    # Entry point and ?type=&mode= router
public/
  keybox/
    index.js                # Keybox mode dispatcher
    upstream.js             # Read-only Keybox Hub-compatible backend adapter
wrangler.jsonc              # Cloudflare Workers deployment
test/router.test.mjs        # Local tests
```

The `public/` directory holds **JavaScript backend modules**, not public static files. Do not set `assets.directory` to `./public`, or their source files could be exposed as assets. Wrangler bundles statically imported modules with `index.js`.

## Endpoints

| Request | Purpose |
| --- | --- |
| `/?type=keybox&mode=health` | Local worker health, no upstream required |
| `/?type=keybox&mode=status` | Keybox status and metadata |
| `/?type=keybox&mode=update` | Last keybox update |
| `/?type=keybox&mode=sources` | Configured sources |
| `/?type=keybox&mode=download&profile=rkp` | Download public keybox for profile `rkp` |
| `/?type=keybox&mode=download&profile=hw&format=json` | JSON download |

All listed endpoints are **GET** (HEAD is supported). Responses for `status`, `update`, `sources`, and `download` are forwarded from a configured upstream service. The `type` query parameter is reserved for selecting API modules; use `profile=rkp` or `profile=hw` for download filters.

## Configure a Keybox backend

This project references [hzzmonetvn/keyboxhub-web](https://github.com/hzzmonetvn/keyboxhub-web)'s **public API contract**, but does **not** copy its Node/Express/SQLite code or its database, keys, automatic certificate validation, XML repair, login, upload, or Telegram bot. It is an HTTP backend adapter only.

Set the Worker environment variable `KEYBOX_UPSTREAM_URL` to the base HTTPS URL of **a Keybox Hub server you control or are authorized to use** (no trailing `/api`). Example:

```sh
npx wrangler secret put KEYBOX_UPSTREAM_URL
# Enter your own Keybox Hub server's HTTPS base URL at the prompt.
```

Or configure the variable in Cloudflare Dashboard > Workers & Pages > api > Settings > Variables and Secrets.

If it is not configured, `mode=health` still works, while data-dependent endpoints return **HTTP 503** and `keybox_upstream_not_configured`. They do not invent `strong`, `device`, or `banned` results. An upstream outage returns **HTTP 502**. Worker secrets and certificates must never be committed to Git.

Only read-only public endpoints are exposed. No client-provided URL can control the upstream, and the adapter does not proxy authentication or write methods.

To run the original Keybox Hub functionality on Cloudflare Workers without an external server requires a separate port: replace `better-sqlite3` with D1, file storage with R2, port the crypto/validation logic and add auth/rate limiting.

## Test and deployment

```sh
node --test
npx wrangler deploy --dry-run
npx wrangler deploy
```

GitHub-connected Cloudflare Workers Builds deploys pushes to `main` using the existing `npx wrangler deploy` command. The custom domain configuration is unchanged.
