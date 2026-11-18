import { createHash } from "node:crypto";

const MAX_BODY_BYTES = 1024;
export const requestUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

export function handoffResponse(
  body: unknown,
  status = 200,
  headers = new Headers(),
) {
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return Response.json(body, { status, headers });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readHandoffObject(
  request: Request,
  fields: readonly string[],
  invalid: () => Response,
  respond = handoffResponse,
  maxBodyBytes = MAX_BODY_BYTES,
): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json")
    return respond({ error: "Use application/json." }, 415);
  if (!request.body) return invalid();

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        return respond({ error: "Request payload is too large." }, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (
      !isRecord(body) ||
      Object.keys(body).length !== fields.length ||
      !fields.every((field) => Object.hasOwn(body, field))
    )
      return invalid();
    return body;
  } catch {
    void reader.cancel().catch(() => {});
    return invalid();
  } finally {
    reader.releaseLock();
  }
}

export async function readHandoffField(
  request: Request,
  field: "requestId" | "token",
  pattern: RegExp,
  invalid: () => Response,
  respond = handoffResponse,
): Promise<string | Response> {
  const body = await readHandoffObject(request, [field], invalid, respond);
  if (body instanceof Response) return body;
  const value = body[field];
  return typeof value === "string" && pattern.test(value) ? value : invalid();
}
