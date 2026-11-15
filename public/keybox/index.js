import { proxyKeybox } from "./upstream.js";

export const KEYBOX_MODES = Object.freeze(["health", "status", "update", "sources", "download"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });

export async function handleKeybox(request, env, _ctx, mode) {
  if (!KEYBOX_MODES.includes(mode)) {
    return json({ success: false, error: "unknown_mode", available: KEYBOX_MODES }, 404);
  }

  if (mode === "health") {
    return json({
      success: true,
      service: "keybox",
      status: "ok",
      upstream_configured: Boolean(env?.KEYBOX_UPSTREAM_URL),
      timestamp: new Date().toISOString(),
    });
  }

  if (!env?.KEYBOX_UPSTREAM_URL) {
    return json({
      success: false,
      service: "keybox",
      status: "unconfigured",
      error: "keybox_upstream_not_configured",
      message: "Configure KEYBOX_UPSTREAM_URL to provide actual keybox data.",
    }, 503);
  }

  return proxyKeybox(request, env.KEYBOX_UPSTREAM_URL, mode);
}
