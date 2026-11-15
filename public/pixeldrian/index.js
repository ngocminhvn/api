// Same-origin streaming proxy only. No database, no caching, no server-side speed metric.
import { PAGE } from "./page.js";

const COUNT = 32;
const CHUNK_BYTES = 4_000_000;
const TOTAL_BYTES = 10_000_000;
const FILE_ID = "S4NGwF6i";

function reply(body,status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":"application/json; charset=utf-8",
      "Access-Control-Allow-Origin":"*",
      "Cache-Control":"no-store, no-cache, max-age=0",
      "X-Content-Type-Options":"nosniff"
    }
  });
}

export function cdnUrl(n) {
  if(!Number.isInteger(n) || n < 1 || n > COUNT) throw new RangeError("invalid_cdn");
  return "https://cdn" + n + ".pixeldrain.eu.cc/api/file/" + FILE_ID;
}

export function chunkRanges() {
  return [[0, CHUNK_BYTES - 1], [CHUNK_BYTES, CHUNK_BYTES * 2 - 1], [CHUNK_BYTES * 2, TOTAL_BYTES - 1]];
}

function responseIsExpectedRange(response, start, end) {
  if(response.status !== 206 || !response.body) return false;
  const text = response.headers.get("content-range") || "";
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(text.trim());
  return !!match && Number(match[1]) === start && Number(match[2]) === end;
}

export async function handlePixeldrian(request, fetcher = fetch) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("cdn");
  if(selected === null) {
    return new Response(PAGE, {
      headers: { "Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store, no-cache, max-age=0",
        "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" }
    });
  }
  if(!/^(?:[1-9]|[12]\d|3[0-2])$/.test(selected)) return reply({ error:"invalid_cdn", allowed:"1-32" },400);
  if(request.method === "HEAD") return new Response(null, {status:200,headers:{"Cache-Control":"no-store"}});
  const cdn = Number(selected);
  const ranges = chunkRanges();
  const target = cdnUrl(cdn);
  const abort = new AbortController();
  async function loadRange(start,end) {
    const response = await fetcher(target, {
      method:"GET",
      redirect:"manual",
      headers:{
        "Range":"bytes=" + start + "-" + end,
        "Accept-Encoding":"identity",
        "Cache-Control":"no-cache, no-store"
      },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
      cf: { cacheTtl:0, cacheEverything:false }
    });
    if(!responseIsExpectedRange(response,start,end)) {
      if(response.body) {try {await response.body.cancel()} catch {}}
      throw new Error("cdn_range_error_http_" + response.status);
    }
    return response.body.getReader();
  }
  let reader;
  try { reader = await loadRange(...ranges[0]); }
  catch(e) { abort.abort(); return reply({ error:"upstream_unavailable", cdn, detail:String(e.message).slice(0,120) }, 502); }

  let part = 0;
  let bytesInPart = 0;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        while(true) {
          const { value, done } = await reader.read();
          if(!done) {
            bytesInPart += value.byteLength;
            const expected = ranges[part][1] - ranges[part][0] + 1;
            if(bytesInPart > expected) throw new Error("upstream_range_overflow");
            controller.enqueue(value);
            return;
          }
          if(bytesInPart !== ranges[part][1] - ranges[part][0] + 1) throw new Error("upstream_range_incomplete");
          part++;
          if(part === ranges.length) { controller.close(); abort.abort(); return; }
          bytesInPart = 0;
          reader = await loadRange(...ranges[part]);
        }
      } catch(e) {
        controller.error(e);
        abort.abort();
        try { await reader.cancel(); } catch {}
      }
    },
    async cancel() {
      abort.abort();
      try { await reader.cancel(); } catch {}
    }
  });
  return new Response(body, {status:200,headers:{
    "Content-Type":"application/octet-stream",
    "Cache-Control":"no-store, no-cache, max-age=0",
    "X-Content-Type-Options":"nosniff",
    "Access-Control-Allow-Origin":"*",
    "X-Proxy-Bytes":String(TOTAL_BYTES),
    "X-Pixeldrian-CDN":String(cdn)
  }});
}
