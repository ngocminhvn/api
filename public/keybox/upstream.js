// Read-only adapter for the public Keybox Hub API.
// This does NOT implement certificate validation, storage, or administrative operations.
const MODES = Object.freeze({
  status: "status",
  update: "update",
  sources: "sources",
  download: "download",
});

const error = (code, status, message) =>
  new Response(JSON.stringify({ success: false, error: code, message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });

export async function proxyKeybox(request, upstreamBase, mode) {
  if (!Object.hasOwn(MODES, mode)) {
    return error("unknown_mode", 404, "Unknown Keybox mode.");
  }

  let upstream;
  try {
    upstream = new URL(upstreamBase);
    if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.search || upstream.hash) {
      throw new Error("Invalid upstream URL");
    }
  } catch {
    return error("invalid_upstream_configuration", 503, "KEYBOX_UPSTREAM_URL must be a valid HTTPS base URL.");
  }

  const incoming = new URL(request.url);
  const basePath = upstream.pathname.replace(/\/+$/, "");
  upstream.pathname = `${basePath}/api/${MODES[mode]}`;
  upstream.search = "";

  if (mode === "download") {
    const allowed = ["profile", "id", "format", "is_rkp"];
    for (const key of allowed) {
      const value = incoming.searchParams.get(key);
      if (value !== null) upstream.searchParams.set(key, value);
    }

    const id = upstream.searchParams.get("id");
    const format = upstream.searchParams.get("format");
    const profile = upstream.searchParams.get("profile");
    const isRkp = upstream.searchParams.get("is_rkp");

    if ((id && !/^[1-9]\d{0,9}$/.test(id)) ||
        (format && !["xml", "json"].includes(format)) ||
        (profile && !["rkp", "hw", "strong", "device"].includes(profile)) ||
        (isRkp && !["0", "1"].includes(isRkp))) {
      return error("invalid_download_parameters", 400, "Invalid id, format, profile or is_rkp.");
    }
  }

  let response;
  try {
    response = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        Accept: mode === "download" && incoming.searchParams.get("format") !== "json"
          ? "application/xml"
          : "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return error("upstream_unavailable", 502, "Keybox upstream is unavailable or timed out.");
  }

  const headers = new Headers({
    "Content-Type": response.headers.get("content-type") ||
      (mode === "download" ? "application/xml; charset=utf-8" : "application/json; charset=utf-8"),
    "Cache-Control": mode === "download" ? "no-store" : "public, max-age=30",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });
  if (mode === "download" && response.headers.has("content-disposition")) {
    headers.set("Content-Disposition", response.headers.get("content-disposition"));
  }
  return new Response(response.body, { status: response.status, headers });
}
