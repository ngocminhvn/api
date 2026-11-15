import { asIsoTimestamp, buildKeyboxSummary, extractPublicXmlMetadata, reportedStatus } from "./compat.js";

export const KEYBOX_MODES = Object.freeze(["health", "status", "sources", "download", "update"]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" },
});

async function getStatusCounts(db) {
  // Never promote a source's "valid" claim or a generic "verified" label to strong/device.
  // Those distinctions require independent certificate and revocation verification.
  const [counts, dates] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total_keys,
      SUM(CASE WHEN verification_status='strong' THEN 1 ELSE 0 END) AS strong_count,
      SUM(CASE WHEN verification_status='device' THEN 1 ELSE 0 END) AS device_count,
      SUM(CASE WHEN verification_status='banned' THEN 1 ELSE 0 END) AS banned_count
      FROM keyboxes`).first(),
    db.prepare(`SELECT
      (SELECT MAX(COALESCE(last_seen_at, created_at)) FROM keyboxes) AS updated_at,
      (SELECT MAX(last_checked) FROM keybox_sources) AS looted_at`).first(),
  ]);
  const strong = counts?.strong_count || 0;
  const device = counts?.device_count || 0;
  const totalKeys = counts?.total_keys || 0;
  const totalValid = strong + device;
  return {
    status: strong ? "strong" : device ? "device" : totalKeys ? "unverified" : "banned",
    total_valid: totalValid,
    total_hw_valid: 0, // Cannot identify HW vs RKP from current D1 schema.
    total_rkp_valid: 0,
    strong_count: strong,
    device_count: device,
    banned_count: counts?.banned_count || 0,
    softbanned_count: 0, // Not assessed by this Worker.
    total_keys: totalKeys,
    last_updated: asIsoTimestamp(dates?.updated_at),
    last_looted_at: asIsoTimestamp(dates?.looted_at),
  };
}

async function fromD1(request, env, mode) {
  const db = env.DB;
  if (mode === "sources") {
    const result = await db.prepare(`SELECT id,name,kind,url,enabled,last_checked,last_result,last_error,last_imported
      FROM keybox_sources ORDER BY id`).all();
    return json({ sources: result.results.map(r => ({
      id: r.id,
      name: r.name,
      type: r.kind === "raw_xml" || r.kind === "encoded" ? "raw_url" : r.kind,
      url: r.url,
      enabled: r.enabled,
      last_fetched_at: r.last_checked,
      last_status: r.last_result,
      last_error: r.last_error,
      last_imported: r.last_imported,
    })) });
  }
  if (mode === "status") {
    const summary = await getStatusCounts(db);
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit"));
    const requestedOffset = Number(url.searchParams.get("offset"));
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 100;
    const offset = Number.isInteger(requestedOffset) && requestedOffset > 0 ? Math.min(requestedOffset, 1000000) : 0;
    const rows = await db.prepare(`SELECT k.id, k.xml_content, k.verification_status, k.created_at, s.name AS source
      FROM keyboxes k LEFT JOIN keybox_sources s ON s.id=k.source_id
      ORDER BY CASE k.verification_status WHEN 'strong' THEN 0 WHEN 'device' THEN 1 ELSE 2 END, k.id DESC
      LIMIT ? OFFSET ?`).bind(limit, offset).all();
    const keyboxes = rows.results.map(row => buildKeyboxSummary(row, url.origin));
    const out = { ...summary, keyboxes };
    if (summary.total_keys > offset + limit || offset !== 0) {
      out.pagination = { limit, offset, total: summary.total_keys };
    }
    return json(out);
  }
  if (mode === "update") {
    const summary = await getStatusCounts(db);
    return json({ last_updated: summary.last_updated, status: summary.status,
      total_valid: summary.total_valid, last_looted_at: summary.last_looted_at });
  }
  if (mode === "download") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const format = url.searchParams.get("format") || (request.headers.get("accept")?.includes("application/json") ? "json" : "xml");
    const profile = url.searchParams.get("profile");
    if (!["xml", "json"].includes(format) || (id && !/^[1-9]\d{0,9}$/.test(id))) return json({ error: "invalid_parameters" }, 400);
    if (profile && profile !== "all") return json({ error: "profile_not_classified", message: "RKP/HW detection is not implemented; use profile=all." }, 422);
    const item = id
      ? await db.prepare("SELECT id,xml_content,verification_status FROM keyboxes WHERE id=?").bind(Number(id)).first()
      : await db.prepare("SELECT id,xml_content,verification_status FROM keyboxes ORDER BY RANDOM() LIMIT 1").first();
    if (!item) return json({ error: "No keybox available", status: "unverified", message: "No keybox has been imported yet." }, 404);
    const metadata = extractPublicXmlMetadata(item.xml_content);
    if (format === "json") return json({ id: item.id, status: reportedStatus(item.verification_status),
      deviceId: metadata.deviceId, algorithm: metadata.algorithms.join(", ") || "unknown", xml: item.xml_content });
    return new Response(item.xml_content, { headers: {
      "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": 'attachment; filename="keybox.xml"',
      "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff",
      "X-Keybox-Verification": reportedStatus(item.verification_status),
    }});
  }
  return json({ error: "unknown_mode" }, 404);
}

export async function handleKeybox(request, env, ctx, mode) {
  if (!KEYBOX_MODES.includes(mode)) return json({ error: "unknown_mode", available: KEYBOX_MODES }, 404);
  if (mode === "health") return json({ success: true, service: "keybox", status: "ok", database_configured: Boolean(env?.DB), timestamp: new Date().toISOString() });
  if (env?.DB) {
    try { return await fromD1(request, env, mode); }
    catch (e) { console.error("D1 Keybox query error", e); return json({ error: "database_error" }, 503); }
  }
  return json({ error: "database_unavailable", message: "Configure DB (Cloudflare D1) and apply migrations." }, 503);
}
