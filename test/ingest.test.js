import test from "node:test";
import assert from "node:assert/strict";
import { normalizeXml, validIndexEntries, sourceNameForCron, DAILY_SOURCE_CRONS, extractVsteamKeybox } from "../public/keybox/ingest.js";
import worker from "../index.js";
const XML = '<?xml version="1.0"?><AndroidAttestation><Keybox>abc</Keybox></AndroidAttestation>';
test("recognizes raw, encoded, and JSON-wrapped XML", () => {
  assert.equal(normalizeXml(XML), XML);
  assert.equal(normalizeXml(btoa(XML)), XML);
  assert.equal(normalizeXml(JSON.stringify({ data: btoa(XML) })), XML);
  assert.equal(normalizeXml("nonsense"), null);
});
test("index selects only explicitly valid rows", () => {
  const list = validIndexEntries({ data: [{ status: "valid", url: "https://example.com" }, { status: "invalid" }, { status: "VALID" }, { status: "banned" }] });
  assert.equal(list.length, 2);
  assert.throws(() => validIndexEntries({ ok: true }), /unsupported_json_index_shape/);
});
test("five daily cron triggers each map to a distinct source", () => {
  assert.deepEqual(Object.keys(DAILY_SOURCE_CRONS), [
    "0 0 * * *", "10 0 * * *", "20 0 * * *", "30 0 * * *", "40 0 * * *"
  ]);
  assert.deepEqual(Object.keys(DAILY_SOURCE_CRONS).map(sourceNameForCron), [
    "evoker", "zuri", "kowx", "vsteam_hypervs", "vsteam_colourvs"
  ]);
  assert.equal(sourceNameForCron("*/10 * * * *"), null);
});
test("router health and error outputs", async () => {
  const get = (qs) => worker.fetch(new Request("https://api.ngocminh.io.vn/"+qs), {}, {});
  let r = await get("?type=keybox&mode=health"); assert.equal(r.status,200);
  assert.equal((await r.json()).database_configured,false);
  r = await get("?type=keybox&mode=status"); assert.equal(r.status,503);
  r = await get("?type=bad&mode=status"); assert.equal(r.status,404);
});

test("VSTeam HyperVS/ColourVS KEYBOX is case-insensitive, nested, and decoded", () => {
  const xml = XML;
  assert.equal(extractVsteamKeybox({ KEYBOX: btoa(xml), DEVICE: "test" }), xml);
  assert.equal(extractVsteamKeybox({ profile: { PI: { KEYBOX: xml } } }), xml);
  assert.equal(extractVsteamKeybox(JSON.stringify({ data: [{ keybox: btoa(xml) }] })), xml);
  assert.throws(() => extractVsteamKeybox({ profile: { data: "not-a-keybox" } }), /vsteam_keybox_field_missing/);
  assert.throws(() => extractVsteamKeybox({ KEYBOX: "unknown-encoded-data" }), /vsteam_keybox_decode_failed/);
  assert.throws(() => extractVsteamKeybox("bad json"), /vsteam_invalid_json/);
});
