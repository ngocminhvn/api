// 10 MB on-device benchmark support: fixed-host streaming proxy, no D1 or result caching.
import { PAGE } from "./page.js";

const CDN_COUNT = 32;
const PART_BYTES = 4 * 1024 * 1024;
const TOTAL_BYTES = 10_000_000;
const FILE_ID = "S4NGwF6i";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, max-age=0",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  },
});

export function cdnUrl(n) {
  if (!Number.isInteger(n) || n < 1 || n > CDN_COUNT) throw new RangeError("invalid_cdn");
  return `https://cdn${n}.pixeldrain.eu.cc/api/file/${FILE_ID}`;
}

export function chunkRanges() {
  return [
    [0, PART_BYTES - 1],
    [PART_BYTES, PART_BYTES * 2 - 1],
    [PART_BYTES * 2, TOTAL_BYTES - 1],
  ];
}

function parseRange(header, requestedStart, requestedEnd) {
  if (!header) return requestedEnd - requestedStart + 1;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!match) throw new Error("invalid_content_range");
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from !== requestedStart || to < from) throw new Error("wrong_content_range");
  return to - from + 1;
}

export async function handlePixeldrian(request, fetcher = fetch) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("cdn");

  if (selected === null) {
    return new Response(PAGE, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (!/^(?:[1-9]|[12]\d|3[0-2])$/.test(selected)) {
    return json({ error: "invalid_cdn", allowed: "1-32" }, 400);
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const cdn = Number(selected);
  const target = cdnUrl(cdn);
  const aborter = new AbortController();

  async function fetchPart(start) {
    const end = Math.min(TOTAL_BYTES - 1, start + PART_BYTES - 1);
    const response = await fetcher(target, {
      method: "GET",
      redirect: "manual",
      headers: {
        "Range": `bytes=${start}-${end}`,
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache, no-store",
      },
      signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(30_000)]),
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    if (!response.body) throw new Error(`no_body_http_${response.status}`);
    if (response.status === 200 && start === 0) {
      // Some mirrors ignore Range and return the whole file.
      // Stream only the first 10 MB, then cancel the upstream connection.
      return { reader: response.body.getReader(), length: Infinity, status: 200 };
    }
    if (response.status !== 206) {
      try { await response.body.cancel(); } catch {}
      throw new Error(`upstream_http_${response.status}`);
    }

    let length;
    try {
      length = parseRange(response.headers.get("Content-Range"), start, end);
    } catch (error) {
      try { await response.body.cancel(); } catch {}
      throw error;
    }
    if (length < 1) {
      try { await response.body.cancel(); } catch {}
      throw new Error("empty_content_range");
    }
    return { reader: response.body.getReader(), length, status: 206 };
  }

  let part;
  try {
    part = await fetchPart(0);
  } catch (error) {
    aborter.abort();
    return json({
      error: "upstream_unavailable",
      cdn,
      detail: String(error?.message || error).slice(0, 160),
    }, 502);
  }

  let totalRead = 0;
  let readInPart = 0;
  const initialHttpStatus = part.status;

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await part.reader.read();
        if (!chunk.done) {
          const remaining = TOTAL_BYTES - totalRead;
          const remainingPart = part.length - readInPart;
          const length = Math.min(chunk.value.byteLength, remaining, remainingPart);
          if (length <= 0) throw new Error("invalid_upstream_chunk");
          controller.enqueue(length === chunk.value.byteLength ? chunk.value : chunk.value.subarray(0, length));
          totalRead += length;
          readInPart += length;

          if (totalRead === TOTAL_BYTES) {
            controller.close();
            try { await part.reader.cancel(); } catch {}
            aborter.abort();
          }
          return;
        }

        if (readInPart !== part.length) {
          // A full-file 200 response can have no Content-Length; here less than
          // 10 MB from the origin is an error, not a valid speed measurement.
          throw new Error("incomplete_upstream_range");
        }
        if (totalRead >= TOTAL_BYTES) {
          controller.close();
          aborter.abort();
          return;
        }
        part = await fetchPart(totalRead);
        readInPart = 0;
      } catch (error) {
        console.error("Pixeldrian streaming error:", cdn, String(error?.message || error).slice(0, 160));
        controller.error(error);
        aborter.abort();
        try { await part.reader.cancel(); } catch {}
      }
    },
    async cancel() {
      aborter.abort();
      try { await part.reader.cancel(); } catch {}
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store, no-cache, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "X-Proxy-Bytes": String(TOTAL_BYTES),
      "X-Pixeldrian-CDN": String(cdn),
      "X-Pixeldrian-Upstream-Status": String(initialHttpStatus),
    },
  });
}
