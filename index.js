import { handleKeybox, KEYBOX_MODES } from "./public/keybox/index.js";
import { scheduledIngest } from "./public/keybox/ingest.js";
import { handlePixeldrian } from "./public/pixeldrian/index.js";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff", ...headers },
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type", "Access-Control-Max-Age": "86400" } });
    if (request.method !== "GET" && request.method !== "HEAD") return json({ success: false, error: "method_not_allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });

    if (pathname === "/pixeldrian") {
      try {
        const response = await handlePixeldrian(request);
        return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
      } catch (e) {
        console.error("Pixeldrian handler error", e);
        return json({ success: false, error: "internal_error" }, 500);
      }
    }

    let mode;
    if (pathname === "/keybox") {
      mode = url.searchParams.get("action");
    } else if (pathname === "/") {
      // Old links remain compatible.
      const type = url.searchParams.get("type");
      if (!type) return json({
        name: "ngocminh API",
        usage: "/keybox?action=status",
        endpoints: { keybox: "/keybox?action=...", pixeldrian: "/pixeldrian" },
        services: { keybox: KEYBOX_MODES },
      });
      if (type !== "keybox") return json({ success: false, error: "unknown_type", available: ["keybox"] }, 404);
      mode = url.searchParams.get("mode") || url.searchParams.get("action");
    } else {
      return json({ success: false, error: "not_found" }, 404);
    }

    if (!mode) return json({ success: false, error: "missing_action", available: KEYBOX_MODES }, 400);
    try {
      const response = await handleKeybox(request, env, ctx, mode);
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    } catch (e) {
      console.error("Unhandled Keybox API error", e);
      return json({ success: false, error: "internal_error" }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledIngest(env, event.cron).then(
      result => console.log("keybox_cron", JSON.stringify(result))
    ));
  },
};
