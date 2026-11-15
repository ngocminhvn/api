/** Scheduled ingestion of publicly shared keybox XML; source claims are NOT certificate validation. */
const MAX_XML = 256 * 1024;
const MAX_INDEX = 512 * 1024;
const MAX_INDEX_ITEMS = 3;
const TIMEOUT_MS = 8000;
const SOURCE_NAMES = ["evoker", "zuri", "kowx", "vsteam_hypervs", "vsteam_colourvs"];

export function sourceNameForSchedule(scheduledTime) {
  return SOURCE_NAMES[Math.floor(scheduledTime / 600000) % SOURCE_NAMES.length];
}

function publicHttps(urlText, base) {
  let url;
  try { url = new URL(urlText, base); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.endsWith(".invalid") ||
      hostname.endsWith(".onion") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) return null;
  // Restrict fetched links in JSON indexes to known public keybox hosting endpoints.
  if (!hostname || !(
    hostname === "keybox.kowx712.cc" || hostname === "raw.githubusercontent.com" ||
    hostname === "github.com" || hostname === "rawbin.dpejoh.com" ||
    hostname === "cdn.jsdelivr.net" || hostname === "gitlab.com")) return null;
  return url;
}

async function readLimited(response, maximum) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null && Number(rawLength) > maximum) throw new Error("response_too_large");
  if (!response.body) throw new Error("empty_body");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const buffer = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { buffer.set(chunk, pos); pos += chunk.byteLength; }
  return new TextDecoder().decode(buffer).replace(/^\uFEFF/, "").trim();
}

async function fetchText(url, maxSize) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json, application/xml, text/plain;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return readLimited(response, maxSize);
}

function validXml(input) {
  if (typeof input !== "string") return null;
  const xml = input.replace(/^\uFEFF/, "").trim();
  if (xml.length === 0 || xml.length > MAX_XML ||
      !/<AndroidAttestation\b/i.test(xml) || !/<Keybox\b/i.test(xml) ||
      !/<\/Keybox\s*>/i.test(xml) || !/<\/AndroidAttestation\s*>/i.test(xml)) return null;
  return xml;
}

function decodeBase64(input) {
  const normalized = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length < 30 || normalized.length > 400000) return null;
  try { return atob(normalized); } catch { return null; }
}

function decodeHex(input) {
  const cleaned = input.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (cleaned.length < 60 || cleaned.length > 2 * MAX_XML || cleaned.length % 2 || !/^[a-f\d]+$/i.test(cleaned)) return null;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; ++i) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

export function normalizeXml(input, depth = 0) {
  if (depth > 3 || typeof input !== "string") return null;
  const raw = input.trim();
  const direct = validXml(raw);
  if (direct) return direct;
  if (raw.startsWith("{") || raw.startsWith('"')) {
    try {
      const decoded = JSON.parse(raw);
      if (typeof decoded === "string") return normalizeXml(decoded, depth + 1);
      if (decoded && typeof decoded === "object") {
        for (const key of ["xml", "content", "data", "keybox", "key", "encoded", "base64", "payload"]) {
          if (typeof decoded[key] === "string") {
            const result = normalizeXml(decoded[key], depth + 1);
            if (result) return result;
          }
        }
      }
    } catch { /* Not JSON. */ }
  }
  const base = decodeBase64(raw);
  if (base) { const result = normalizeXml(base, depth + 1); if (result) return result; }
  const hex = decodeHex(raw);
  if (hex) { const result = normalizeXml(hex, depth + 1); if (result) return result; }
  return null;
}


/**
 * VSTeam exposes a JSON PI profile. Only decode the KEYBOX field;
 * never treat other fields (tokens, props, or settings) as keybox XML.
 * Handles a direct XML string or the supported Base64/Hex/JSON encodings.
 * Unknown proprietary encryption is reported, not guessed.
 */
export function extractVsteamKeybox(body) {
  let data = body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); }
    catch { throw new Error("vsteam_invalid_json"); }
  }
  const visited = new WeakSet();
  function find(node, depth = 0) {
    if (node === null || typeof node !== "object" || depth > 8 || visited.has(node)) return undefined;
    visited.add(node);
    const properties = Object.entries(node).slice(0, 200);
    for (const [name, value] of properties) {
      if (name.toLowerCase() !== "keybox") continue;
      if (typeof value === "string") return normalizeXml(value);
      if (value && typeof value === "object") {
        const xml = normalizeXml(JSON.stringify(value));
        if (xml) return xml;
      }
      return null;
    }
    for (const [, value] of properties) {
      if (value && typeof value === "object") {
        const result = find(value, depth + 1);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  }
  const xml = find(data);
  if (xml === undefined) throw new Error("vsteam_keybox_field_missing");
  if (!xml) throw new Error("vsteam_keybox_decode_failed");
  return xml;
}

export function validIndexEntries(payload) {
  const list = Array.isArray(payload) ? payload :
    [payload?.keyboxes, payload?.data?.keyboxes, payload?.data?.items, payload?.data,
      payload?.results, payload?.items, payload?.records].find(Array.isArray);
  if (!Array.isArray(list)) throw new Error("unsupported_json_index_shape");
  return list.filter(row => row && typeof row === "object" && String(row.status || "").toLowerCase() === "valid");
}

function entryLink(entry, base) {
  const properties = ["download_url", "downloadUrl", "raw_url", "rawUrl", "url", "link", "file_url", "fileUrl"];
  for (const property of properties) {
    if (typeof entry[property] === "string") {
      const u = publicHttps(entry[property], base);
      if (u) return u;
    }
  }
  return null;
}

async function hashXml(xml) {
  const data = new TextEncoder().encode(xml);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function saveXml(db, source, xml, originUrl, claim) {
  const hash = await hashXml(xml);
  await db.prepare(`INSERT INTO keyboxes (source_id, sha256, xml_content, source_claim, verification_status, origin_url)
    VALUES (?, ?, ?, ?, 'unverified', ?)
    ON CONFLICT(sha256) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP`)
    .bind(source.id, hash, xml, claim, originUrl).run();
}

export async function ingestSource(db, source) {
  const checkedAt = new Date().toISOString();
  let imported = 0;
  let result = "success";
  let error = null;
  try {
    if (source.name === "vsteam_hypervs" || source.name === "vsteam_colourvs") {
      const expectedBranch = source.name === "vsteam_hypervs" ? "HyperVS" : "ColourVS";
      const sourceUrl = new URL(source.url);
      if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "vsteam.vn" ||
          sourceUrl.pathname !== "/api/profile" || sourceUrl.searchParams.get("type") !== "pi" ||
          sourceUrl.searchParams.get("branch") !== expectedBranch) {
        throw new Error("invalid_vsteam_source_url");
      }
      const body = await fetchText(sourceUrl.toString(), MAX_INDEX);
      const xml = extractVsteamKeybox(body);
      await saveXml(db, source, xml, source.url, "unknown");
      imported = 1;
    } else if (source.kind === "raw_xml" || source.kind === "encoded") {
      const body = await fetchText(source.url, MAX_XML);
      const xml = normalizeXml(body);
      if (!xml) throw new Error("unsupported_encoding_or_invalid_xml");
      await saveXml(db, source, xml, source.url, "unknown");
      imported = 1;
    } else if (source.kind === "json_index") {
      const body = await fetchText(source.url, MAX_INDEX);
      let payload;
      try { payload = JSON.parse(body); } catch { throw new Error("invalid_json"); }
      const matches = validIndexEntries(payload);
      if (!matches.length) result = "no_valid_entries";
      let skipped = 0;
      for (const row of matches.slice(0, MAX_INDEX_ITEMS)) {
        const url = entryLink(row, source.url);
        if (!url) { skipped++; continue; }
        try {
          const xml = normalizeXml(await fetchText(url.toString(), MAX_XML));
          if (!xml) { skipped++; continue; }
          await saveXml(db, source, xml, url.toString(), "valid");
          imported++;
        } catch { skipped++; }
      }
      if (skipped && !imported) throw new Error("valid_entries_have_no_supported_download_link_or_xml");
      if (skipped) result = "partial";
    } else throw new Error("unsupported_source_kind");
  } catch (e) {
    result = "error";
    error = String(e?.message || e).slice(0, 200);
  }
  await db.prepare(`UPDATE keybox_sources SET last_checked=?, last_result=?, last_error=?, last_imported=? WHERE id=?`)
    .bind(checkedAt, result, error, imported, source.id).run();
  return { source: source.name, imported, result, error };
}

export async function scheduledIngest(env, scheduledTime) {
  if (!env.DB) throw new Error("D1 binding DB is missing");
  const name = sourceNameForSchedule(scheduledTime);
  const source = await env.DB.prepare("SELECT * FROM keybox_sources WHERE name=? AND enabled=1")
    .bind(name).first();
  if (!source) return { source: name, imported: 0, result: "disabled_or_missing" };
  return ingestSource(env.DB, source);
}
