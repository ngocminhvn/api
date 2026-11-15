export const KEYBOX_MODES = Object.freeze(["health", "status", "sources", "download", "update"]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" },
});

async function fromD1(request, env, mode) {
  const db = env.DB;
  if (mode === "sources") {
    const result = await db.prepare(`SELECT name,kind,url,last_checked,last_result,last_error,last_imported
      FROM keybox_sources WHERE enabled=1 ORDER BY id`).all();
    return json({ success: true, sources: result.results });
  }
  if (mode === "status") {
    const stats = await db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN source_claim='valid' THEN 1 ELSE 0 END) AS source_claimed_valid,
      SUM(CASE WHEN verification_status='verified' THEN 1 ELSE 0 END) AS independently_verified FROM keyboxes`).first();
    const updated = await db.prepare("SELECT MAX(last_checked) AS last_checked FROM keybox_sources").first();
    return json({ success: true, service: "keybox", status: "unverified", total: stats.total || 0,
      source_claimed_valid: stats.source_claimed_valid || 0, independently_verified: stats.independently_verified || 0,
      last_checked: updated.last_checked, note: "Source status=valid is not independent cryptographic verification." });
  }
  if (mode === "update") {
    const r = await db.prepare("SELECT MAX(last_checked) AS last_checked FROM keybox_sources").first();
    return json({ success: true, last_checked: r.last_checked });
  }
  if (mode === "download") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const format = url.searchParams.get("format") || "xml";
    const profile = url.searchParams.get("profile");
    if (!['xml','json'].includes(format) || (id && !/^[1-9]\d{0,9}$/.test(id))) return json({ error: "invalid_parameters" }, 400);
    if (profile && profile !== "all") return json({ error: "profile_not_classified", message: "RKP/HW detection is not implemented; use profile=all." }, 422);
    const item = id
      ? await db.prepare("SELECT id,xml_content,source_claim,verification_status FROM keyboxes WHERE id=?").bind(Number(id)).first()
      : await db.prepare("SELECT id,xml_content,source_claim,verification_status FROM keyboxes ORDER BY RANDOM() LIMIT 1").first();
    if (!item) return json({ error: "no_keyboxes", message: "No keyboxes have been imported yet." }, 404);
    if (format === "json") return json({ id: item.id, source_claim: item.source_claim, verification_status: item.verification_status, xml: item.xml_content });
    return new Response(item.xml_content, { headers: {
      "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="keybox-${item.id}.xml"`,
      "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff",
      "X-Keybox-Verification": item.verification_status,
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
