import { PAGE } from "./page.js";

// Fedora speed test results viewer: the Worker only serves static HTML and never fetches CDN files.
// Keeping a small discontinued-proxy response prevents accidental bandwidth use.
const CDN_COUNT = 32;
const FILE_ID = "S4NGwF6i";

const json = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  },
});

export function cdnUrl(n) {
  if (!Number.isInteger(n) || n < 1 || n > CDN_COUNT) throw new RangeError("invalid_cdn");
  return `https://cdn${String(n).padStart(2, "0")}.pixeldrain.eu.cc/api/file/${FILE_ID}`;
}

export async function handlePixeldrian(request) {
  const url = new URL(request.url);
  if (url.searchParams.has("cdn")) {
    return json({
      error: "proxy_disabled",
      message: "Run scripts/pixeldrian_speed.py on Fedora and import its JSON into /pixeldrian. The old ?cdn=N proxy is disabled.",
    }, 410);
  }
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
