import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicXmlMetadata, asIsoTimestamp } from "../public/keybox/compat.js";
import worker from "../index.js";

const XML = `<AndroidAttestation><Keybox DeviceID="Sample-Device"><Key algorithm="ecdsa"><PrivateKey>PRIVATE-SECRET</PrivateKey><Certificate format="pem">-----BEGIN CERTIFICATE-----\nEXAMPLE\n-----END CERTIFICATE-----</Certificate></Key></Keybox></AndroidAttestation>`;
const row = { id: 7, xml_content: XML, verification_status: "unverified", created_at: "2026-11-15 13:00:12", source: "zuri" };
const db = {
  prepare(sql) {
    return {
      bind(...args) { this.params = args; return this; },
      async first() {
        if (sql.includes("COUNT(*) AS total_keys")) return { total_keys: 1, strong_count: 0, device_count: 0, banned_count: 0 };
        if (sql.includes("looted_at")) return { updated_at: "2026-11-15 13:00:12", looted_at: "2026-11-15T13:20:12Z" };
        if (sql.includes("FROM keyboxes WHERE id=?") || sql.includes("ORDER BY RANDOM()")) return row;
        throw Error("Unexpected SQL " + sql);
      },
      async all() {
        if (sql.includes("FROM keyboxes k LEFT JOIN")) return { results: [row] };
        if (sql.includes("FROM keybox_sources ORDER BY")) return { results: [{ id: 2, name: "zuri", kind: "raw_xml", url: "https://example.org/a.xml", enabled: 1, last_checked: "2026-11-15T13:20:12Z", last_result: "success", last_error: null, last_imported: 1 }] };
        throw Error("Unexpected SQL " + sql);
      },
    };
  },
};
const request = (mode) => worker.fetch(new Request(`https://api.ngocminh.io.vn/keybox?action=${mode}`), { DB: db }, {});

test("public XML metadata is correct", () => {
  assert.equal(extractPublicXmlMetadata(XML).deviceId, "Sample-Device");
  assert.equal(extractPublicXmlMetadata(XML).certificate_count, 1);
  assert.deepEqual(extractPublicXmlMetadata(XML).algorithms, ["ecdsa"]);
  assert.equal(asIsoTimestamp("2026-11-15 13:00:12"), "2026-11-15T13:00:12.000Z");
});

test("status matches Keybox Hub keys; unverified stays unverified; no private key leaked", async () => {
  const result = await (await request("status")).json();
  assert.deepEqual(Object.keys(result), ["status", "total_valid", "total_hw_valid", "total_rkp_valid", "strong_count", "device_count", "banned_count", "softbanned_count", "total_keys", "last_updated", "last_looted_at", "keyboxes"]);
  assert.equal(result.total_keys, 1);
  assert.equal(result.total_valid, 0);
  assert.equal(result.status, "unverified");
  assert.equal(result.keyboxes[0].profile, "unknown");
  assert.equal(result.keyboxes[0].is_rkp, null);
  assert.equal(result.keyboxes[0].device_id, "Sample-Device");
  assert.equal(result.keyboxes[0].download_url, "https://api.ngocminh.io.vn/keybox?action=download&id=7");
  assert.ok(!JSON.stringify(result).includes("PRIVATE-SECRET"));
});

test("update matches four Keybox Hub properties", async () => {
  const result = await (await request("update")).json();
  assert.deepEqual(Object.keys(result), ["last_updated", "status", "total_valid", "last_looted_at"]);
});

test("download JSON shape matches Keybox Hub", async () => {
  const result = await (await request("download&format=json&id=7")).json();
  assert.deepEqual(Object.keys(result), ["id", "status", "deviceId", "algorithm", "xml"]);
  assert.equal(result.deviceId, "Sample-Device");
  assert.equal(result.xml, XML);
});

test("sources has Keybox Hub-compatible fields", async () => {
  const result = await (await request("sources")).json();
  assert.deepEqual(Object.keys(result), ["sources"]);
  assert.equal(result.sources[0].type, "raw_url");
  assert.equal(result.sources[0].last_fetched_at, "2026-11-15T13:20:12Z");
  assert.equal(result.sources[0].last_status, "success");
});

test("old query-mode links remain valid for existing clients", async () => {
  const legacy = await worker.fetch(new Request("https://api.ngocminh.io.vn/?type=keybox&mode=health"), { DB: db }, {});
  const fresh = await worker.fetch(new Request("https://api.ngocminh.io.vn/keybox?action=health"), { DB: db }, {});
  assert.equal(legacy.status,200);
  assert.equal(fresh.status,200);
});
