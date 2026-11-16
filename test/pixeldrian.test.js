import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { handlePixeldrian, cdnUrl } from "../public/pixeldrian/index.js";
import { PAGE } from "../public/pixeldrian/page.js";
import worker from "../index.js";

test("fixed CDN hostnames always use two-digit suffixes", () => {
  assert.equal(cdnUrl(1), "https://cdn01.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(3), "https://cdn03.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(23), "https://cdn23.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(32), "https://cdn32.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.throws(() => cdnUrl(33), RangeError);
});

test("page only reads a local file; Worker does not proxy CDN traffic or use D1", async () => {
  const r = await worker.fetch(new Request("https://api.ngocminh.io.vn/pixeldrian?utm_source=chatgpt.com"), {}, {});
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(r.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.match(PAGE, /type="file"/);
  assert.match(PAGE, /file\.text\(\)/);
  assert.match(PAGE, /scripts\/pixeldrian_speed\.py/);
  assert.doesNotMatch(PAGE, /\bfetch\s*\(/);
  assert.doesNotMatch(PAGE, /XMLHttpRequest/);
  for (const n of [3, 23]) {
    const disabled = await handlePixeldrian(new Request(`https://api.ngocminh.io.vn/pixeldrian?cdn=${n}`));
    assert.equal(disabled.status, 410);
    assert.equal((await disabled.json()).error, "proxy_disabled");
  }
});

test("file import ranks only successful results and never uploads content", async () => {
  const script = PAGE.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "Missing page script");
  class Element {
    constructor() { this.textContent = ""; this.children = []; this.handlers = {}; this.files = []; this.value = ""; this.size = 0; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(name, cb) { this.handlers[name] = cb; }
  }
  const dom = Object.fromEntries(["report", "message", "summary", "ranking", "errors", "raw", "clear"].map(k => [k,new Element()]));
  vm.runInNewContext(script, {
    document: { getElementById(id) { return dom[id]; }, createElement() { return new Element(); } },
    JSON, Number, String, Array,
  });
  const report = {service:"pixeldrian", measured_from:"fedora_curl_direct", finished_at:"2026-11-16T10:00:00Z", results: [
    {cdn:23,status:"ok",http_status:206,speed_MBps:2.88,speed_Mbps:23.04,duration_ms:3472},
    {cdn:4,status:"error",http_status:403,error:"http_403",speed_MBps:null},
    {cdn:3,status:"ok",http_status:200,speed_MBps:1.14,speed_Mbps:9.12,duration_ms:8772}
  ]};
  dom.report.files = [{ size: 500, text: async () => JSON.stringify(report) }];
  await dom.report.handlers.change();
  assert.equal(dom.ranking.children.length, 2);
  assert.equal(dom.ranking.children[0].children[1].textContent, "CDN23");
  assert.equal(dom.errors.children.length, 1);
  assert.equal(dom.errors.children[0].children[1].textContent, "403");
  assert.match(dom.raw.textContent, /fedora_curl_direct/);
  assert.match(dom.message.textContent, /CDN23/);
  dom.clear.handlers.click();
  assert.equal(dom.ranking.children.length, 0);
  assert.equal(dom.errors.children.length, 0);
});

test("Keybox URL compatibility remains intact", async () => {
  for (const endpoint of ["/keybox?action=health", "/?type=keybox&mode=health"]) {
    const r = await worker.fetch(new Request("https://api.ngocminh.io.vn"+endpoint), {}, {});
    assert.equal(r.status, 200);
  }
});
