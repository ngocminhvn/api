import test from "node:test";
import assert from "node:assert/strict";
import { handlePixeldrian, cdnUrl, chunkRanges } from "../public/pixeldrian/index.js";
import worker from "../index.js";

test("browser page measures on client, requires no D1 and no server result cache", async () => {
  const request = new Request("https://api.ngocminh.io.vn/pixeldrian");
  const response = await worker.fetch(request, {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const page = await response.text();
  assert.match(page, /performance\.now\(\)/);
  assert.match(page, /pixeldrian\?cdn=/);
  assert.match(page, /CONCURRENCY = 3/);
  assert.match(page, /JSON\.stringify\(state/);
});

test("only fixed CDN hostname indices 1..32 are allowed", async () => {
  assert.equal(cdnUrl(1), "https://cdn1.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(32), "https://cdn32.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.throws(() => cdnUrl(33));
  for (const input of ["0", "33", "test", "1/path", "1.5", "-1"]) {
    const response = await handlePixeldrian(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=" + encodeURIComponent(input)));
    assert.equal(response.status, 400);
  }
});

test("streams 10 MB via 4+4+2 MB sequential HTTP ranges, no D1", async () => {
  const ranges = chunkRanges();
  assert.deepEqual(ranges, [[0, 3999999], [4000000, 7999999], [8000000, 9999999]]);
  let index = 0;
  const fakeFetch = async (url, options) => {
    assert.equal(url, cdnUrl(8));
    assert.equal(options.redirect, "manual");
    const [start, end] = ranges[index++];
    assert.equal(options.headers.Range, `bytes=${start}-${end}`);
    const size = end - start + 1;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(size)); controller.close(); }
    });
    return new Response(body, { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/99999999` } });
  };
  const response = await handlePixeldrian(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=8"), fakeFetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  const buffer = await response.arrayBuffer();
  assert.equal(buffer.byteLength, 10000000);
  assert.equal(index, 3);
});

test("rejects upstream that ignores HTTP Range or redirects", async () => {
  const response = await handlePixeldrian(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=1"),
    async () => new Response("full content not a range", { status: 200 }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "upstream_unavailable");
  const redirected = await handlePixeldrian(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=1"),
    async () => new Response(null, { status: 302, headers: { Location:"https://example.com" } }));
  assert.equal(redirected.status, 502);
});

test("HEAD does not consume 10 MB", async () => {
  const response = await worker.fetch(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=5", { method:"HEAD" }), {}, {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("new Keybox routing and old query API both respond", async () => {
  const fresh = await worker.fetch(new Request("https://api.ngocminh.io.vn/keybox?action=health"), {}, {});
  assert.equal(fresh.status,200);
  assert.equal((await fresh.json()).database_configured,false);
  const old = await worker.fetch(new Request("https://api.ngocminh.io.vn/?type=keybox&mode=health"), {}, {});
  assert.equal(old.status,200);
});
