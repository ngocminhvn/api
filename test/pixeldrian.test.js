import test from "node:test";
import assert from "node:assert/strict";
import { handlePixeldrian, cdnUrl, chunkRanges } from "../public/pixeldrian/index.js";
import worker from "../index.js";

test("client page uses performance.now and no D1/cache", async () => {
  const response = await worker.fetch(new Request("https://api.ngocminh.io.vn/pixeldrian"), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const page = await response.text();
  assert.match(page, /performance\.now\(\)/);
  assert.match(page, /pixeldrian\?cdn=/);
  assert.match(page, /http_status/);
  assert.match(page, /body\.detail/);
});

test("cdn is fixed to indices 1..32", async () => {
  assert.equal(cdnUrl(1), "https://cdn1.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.equal(cdnUrl(32), "https://cdn32.pixeldrain.eu.cc/api/file/S4NGwF6i");
  assert.throws(() => cdnUrl(33));
  for(const input of ["0","33","0.0","x","1/path"]) {
    const response = await handlePixeldrian(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn="+encodeURIComponent(input)));
    assert.equal(response.status, 400);
  }
});

test("206 ranges are 4 MiB, 4 MiB, then remaining bytes", async () => {
  const ranges = chunkRanges();
  assert.deepEqual(ranges, [[0, 4194303], [4194304, 8388607], [8388608, 9999999]]);
  let index = 0;
  const mockFetch = async (url, options) => {
    assert.equal(url, cdnUrl(8));
    const [start, end] = ranges[index++];
    assert.equal(options.headers.Range, `bytes=${start}-${end}`);
    assert.equal(options.redirect, "manual");
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(end - start + 1));
        controller.close();
      }
    }), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/100000000` } });
  };
  const response = await handlePixeldrian(new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=8"), mockFetch);
  assert.equal(response.status,200);
  const data = await response.arrayBuffer();
  assert.equal(data.byteLength,10000000);
  assert.equal(index,3);
});

test("HTTP 200 full download is clipped to 10 MB", async () => {
  let requests=0;
  const response = await handlePixeldrian(
    new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=9"),
    async () => {
      requests++;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(10_000_000));
          controller.enqueue(new Uint8Array(2_000_000));
          controller.close();
        }
      }), { status:200 });
    }
  );
  assert.equal(response.status,200);
  assert.equal((await response.arrayBuffer()).byteLength,10_000_000);
  assert.equal(requests,1);
});

test("upstream 403, redirect and empty body return descriptive 502", async () => {
  const request = new Request("https://api.ngocminh.io.vn/pixeldrian?cdn=1");
  let response = await handlePixeldrian(request, async () => new Response("forbidden", {status:403}));
  assert.equal(response.status,502);
  assert.match((await response.json()).detail,/upstream_http_403/);
  response = await handlePixeldrian(request, async () => new Response(null,{status:302,headers:{Location:"https://other.example"}}));
  assert.equal(response.status,502);
});

test("new and old routes are preserved", async () => {
  for(const endpoint of ["/keybox?action=health","/?type=keybox&mode=health"]) {
    const response=await worker.fetch(new Request("https://api.ngocminh.io.vn"+endpoint), {}, {});
    assert.equal(response.status,200);
  }
});
