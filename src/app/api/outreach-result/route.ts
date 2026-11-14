import { parseOutreachResult } from "@/lib/outreach";
import { isSameOriginRequest } from "@/lib/request-origin";

type Capability = { requestId: string; readKey: string };

class BodyTooLarge extends Error {}

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function isJson(headers: Headers): boolean {
  return (
    headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ===
    "application/json"
  );
}

function cancelBody(body: ReadableStream<Uint8Array> | null) {
  void body?.cancel().catch(() => {});
}

async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new BodyTooLarge();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCapability(value: unknown): Capability | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.requestId,
    ) ||
    typeof value.readKey !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.readKey)
  )
    return null;
  return { requestId: value.requestId, readKey: value.readKey };
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return response({ error: "Cross-site requests are not permitted." }, 403);
  if (!isJson(request.headers))
    return response({ error: "Use application/json." }, 415);

  let capability: Capability | null;
  try {
    capability = parseCapability(await boundedJson(request.body, 1024));
  } catch (error) {
    return response(
      {
        error:
          error instanceof BodyTooLarge
            ? "Request payload is too large."
            : "Invalid capability request.",
      },
      error instanceof BodyTooLarge ? 413 : 400,
    );
  }
  if (!capability)
    return response({ error: "Invalid capability request." }, 400);

  try {
    const signal = AbortSignal.timeout(10_000);
    const upstream = await fetch(
      "https://harbor-voice-lab.vercel.app/api/outreach-result",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capability),
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal,
      },
    );
    if (!upstream.ok || upstream.redirected || !isJson(upstream.headers)) {
      cancelBody(upstream.body);
      if (upstream.status === 404 && !upstream.redirected)
        return response({ error: "Outreach result is not available." }, 404);
      throw new Error("Unavailable upstream");
    }
    const payload = await boundedJson(upstream.body, 256 * 1024, signal);
    if (!isRecord(payload)) throw new Error("Invalid result");
    const { state, updatedAt, findings, nextSteps } = payload;
    for (const [items, max] of [
      [findings, 16],
      [nextSteps, 12],
    ] as const) {
      if (
        Array.isArray(items) &&
        (items.length > max ||
          items.some((item) => typeof item === "string" && item.length > 1200))
      )
        throw new Error("Result exceeds service limits");
    }
    const result = parseOutreachResult({
      state,
      updatedAt,
      findings,
      nextSteps,
    });
    if (!result) throw new Error("Invalid result");
    return response(result);
  } catch {
    return response(
      { error: "Outreach result could not be loaded. Please retry." },
      503,
    );
  }
}
