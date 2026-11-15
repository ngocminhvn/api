import test from "node:test";
import assert from "node:assert/strict";
import worker from "../index.js";

const invoke = (query, env = {}, method = "GET") =>
  worker.fetch(new Request("https://api.ngocminh.io.vn/" + query, { method }), env, {});

test("root describes modules, no HTML", async () => {
  const response = await invoke("");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.services.keybox.includes("status"));
});

test("health runs without upstream", async () => {
  const response = await invoke("?type=keybox&mode=health");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.status, "ok");
  assert.equal(data.upstream_configured, false);
});

test("status does not fabricate keybox state without upstream", async () => {
  const response = await invoke("?type=keybox&mode=status");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "keybox_upstream_not_configured");
});

test("unknown type and mode fail cleanly", async () => {
  assert.equal((await invoke("?type=missing&mode=status")).status, 404);
  assert.equal((await invoke("?type=keybox&mode=missing")).status, 404);
  assert.equal((await invoke("?type=keybox")).status, 400);
});

test("status forwards to configured API path", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://keybox.example.org/api/status");
    assert.equal(options.method, "GET");
    return new Response('{"status":"strong","total_valid":2}', {
      headers: { "content-type": "application/json" },
    });
  });
  const response = await invoke("?type=keybox&mode=status", {
    KEYBOX_UPSTREAM_URL: "https://keybox.example.org/",
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total_valid, 2);
});

test("download accepts the profile filter and rejects bad input", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "https://keybox.example.org/api/download?profile=rkp&format=xml");
    return new Response("<AndroidAttestation/>", {
      headers: { "content-type": "application/xml" },
    });
  });
  const env = { KEYBOX_UPSTREAM_URL: "https://keybox.example.org" };
  const response = await invoke("?type=keybox&mode=download&profile=rkp&format=xml", env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<AndroidAttestation/>");
  const invalid = await invoke("?type=keybox&mode=download&id=../secrets", env);
  assert.equal(invalid.status, 400);
});

test("rejects insecure upstream and disallowed methods", async () => {
  assert.equal((await invoke("?type=keybox&mode=status", { KEYBOX_UPSTREAM_URL: "http://example.org" })).status, 503);
  assert.equal((await invoke("?type=keybox&mode=status", {}, "POST")).status, 405);
});
