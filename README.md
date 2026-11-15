# api

Cloudflare Worker powering [api.ngocminh.io.vn](https://api.ngocminh.io.vn/).

## Source and deployment

- Entry point: [`worker.js`](worker.js)
- Cloudflare configuration: [`wrangler.jsonc`](wrangler.jsonc)
- Cloudflare Workers Builds is connected to the `main` branch of this repository.
- Pushing to `main` triggers Cloudflare's configured deploy command: `npx wrangler deploy`.

The `worker.js` shown in Cloudflare's online code editor is the deployed Worker module, not a separate GitHub repository. Edit the code here in GitHub, then deploy through the connected build integration.
