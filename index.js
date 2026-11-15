import { handleKeybox, KEYBOX_MODES } from "./public/keybox/index.js";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== "/") {
      return json({ success: false, error: "not_found", message: "Use the root URL with ?type=...&mode=..." }, 404);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ success: false, error: "method_not_allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });
    }

    const type = url.searchParams.get("type");
    const mode = url.searchParams.get("mode");

    if (!type) {
      return json({
        name: "ngocminh API",
        usage: "/?type=keybox&mode=status",
        services: { keybox: KEYBOX_MODES },
      });
    }

    if (type !== "keybox") {
      return json({ success: false, error: "unknown_type", available: ["keybox"] }, 404);
    }

    if (!mode) {
      return json({ success: false, error: "missing_mode", available: KEYBOX_MODES }, 400);
    }

    try {
      const response = await handleKeybox(request, env, ctx, mode);
      if (request.method === "HEAD") {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    } catch (error) {
      console.error("Unhandled API error:", error);
      return json({ success: false, error: "internal_error" }, 500);
    }
  },
};
