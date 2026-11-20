import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/** Bound the actual stream, including requests sent without Content-Length. */
export async function jsonBody<T>(req: Request, schema: ZodType<T>, maxBytes: number): Promise<T | NextResponse> {
  const tooLarge = () => NextResponse.json({ ok: false, reason: "Request body is too large" }, { status: 413 });
  const invalid = () => NextResponse.json({ ok: false, reason: "Invalid request body" }, { status: 400 });
  if (Number(req.headers.get("content-length")) > maxBytes) return tooLarge();
  if (!req.body) return invalid();

  const reader = req.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    const parsed = schema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))));
    return parsed.success ? parsed.data : invalid();
  } catch {
    return invalid();
  } finally {
    reader.releaseLock();
  }
}
