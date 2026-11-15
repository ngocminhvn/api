/**
 * Compatibility helpers for hzzmonetvn/keyboxhub-web's public JSON contract.
 * This is metadata extraction only, NOT cryptographic certificate verification.
 * Raw XML/private keys are never included in a status JSON response.
 */
const CONFIRMED_STATES = new Set(["strong", "device", "banned"]);

export function reportedStatus(value) {
  return CONFIRMED_STATES.has(value) ? value : "unverified";
}

export function asIsoTimestamp(value) {
  if (!value) return null;
  // D1 CURRENT_TIMESTAMP is UTC in "YYYY-MM-DD HH:MM:SS" format.
  const text = String(value);
  const date = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text)
    ? new Date(text.replace(" ", "T") + "Z") : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractKeyboxDeviceId(xml) {
  const keybox = xml.match(/<Keybox\b([^>]*)>/i);
  const id = keybox?.[1].match(/\bDeviceID\s*=\s*(["'])(.*?)\1/i);
  return id?.[2]?.trim().slice(0, 160) || "Unknown Device";
}

export function extractPublicXmlMetadata(xml) {
  const content = String(xml || "");
  const certificate_details = [];
  const algorithms = new Set();
  let certificate_count = 0;
  const keyRe = /<Key\b([^>]*)>([\s\S]*?)<\/Key\s*>/gi;
  let match;
  while ((match = keyRe.exec(content)) !== null) {
    const attr = match[1].match(/\balgorithm\s*=\s*(["'])(.*?)\1/i);
    const algorithm = attr?.[2]?.trim() || "unknown";
    if (algorithm !== "unknown") algorithms.add(algorithm.toLowerCase());
    const declared = [...match[2].matchAll(/<Certificate\b[^>]*>([\s\S]*?)<\/Certificate\s*>/gi)];
    let count = 0;
    for (const entry of declared) {
      const pems = entry[1].match(/-----BEGIN CERTIFICATE-----/g);
      count += pems?.length || 1;
    }
    certificate_count += count;
    certificate_details.push({ algorithm, count });
    if (certificate_details.length >= 16) break;
  }
  return {
    deviceId: extractKeyboxDeviceId(content),
    algorithms: [...algorithms],
    certificate_count,
    certificate_details,
  };
}

export function buildKeyboxSummary(row, origin) {
  const metadata = extractPublicXmlMetadata(row.xml_content);
  const status = reportedStatus(row.verification_status);
  const source = row.source || "unknown";
  return {
    id: row.id,
    name: metadata.deviceId !== "Unknown Device" ? metadata.deviceId : `Keybox #${row.id} (${source})`,
    device_id: metadata.deviceId,
    status,
    profile: "unknown", // RKP/HW requires certificate-chain analysis.
    download_url: `${origin}/?type=keybox&mode=download&id=${row.id}`,
    source,
    uploaded_at: asIsoTimestamp(row.created_at),
    is_rkp: null,
    certificate_count: metadata.certificate_count,
    algorithms: metadata.algorithms,
    certificate_details: metadata.certificate_details,
  };
}
