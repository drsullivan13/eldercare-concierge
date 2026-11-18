import { familyScenarios } from "@/lib/home-care-rehearsal";
import { getProviderEntry } from "@/lib/markets";
import { isSameOriginRequest } from "@/lib/request-origin";
import { bookingAdmin } from "@/lib/supabase/booking-admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_COLUMNS = "request_id, provider_id, status, created_at";
const BRIEF_KEYS = [
  "topics",
  "question",
  "careZip",
  "timing",
  "situation",
  "scenarioId",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BodyTooLarge extends Error {}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new BodyTooLarge();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function briefText(value: unknown, max: number, min = 1): value is string {
  return (
    typeof value === "string" &&
    [...value].length <= max &&
    value.trim().length >= min &&
    // oxlint-disable-next-line eslint/no-control-regex -- Reject invalid brief text.
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value)
  );
}

function parseBrief(value: unknown) {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !BRIEF_KEYS.includes(key))
  )
    return null;
  const { topics, question, careZip, timing, situation, scenarioId } = value;
  if (
    !Array.isArray(topics) ||
    topics.length > 6 ||
    !topics.every((topic) => briefText(topic, 80)) ||
    !briefText(question, 1000, 0) ||
    (!topics.length && !question.trim()) ||
    (careZip !== undefined &&
      (typeof careZip !== "string" || !/^\d{5}$/.test(careZip))) ||
    (timing !== undefined && !briefText(timing, 100)) ||
    (situation !== undefined && !briefText(situation, 500)) ||
    (scenarioId !== undefined &&
      !familyScenarios.some(({ id }) => id === scenarioId))
  )
    return null;
  return {
    topics,
    question,
    ...(careZip !== undefined ? { careZip } : {}),
    ...(timing !== undefined ? { timing } : {}),
    ...(situation !== undefined ? { situation } : {}),
    ...(scenarioId !== undefined ? { scenarioId } : {}),
  };
}

function resolveOffice(providerId: string) {
  const entry = getProviderEntry(providerId);
  if (entry?.market.state === "NJ" && entry.provider.category === "home-care")
    return entry.provider;
}

function serializeRequest(row: {
  request_id: string;
  provider_id: string;
  status: string;
  created_at: string;
}) {
  return {
    requestId: row.request_id,
    providerId: row.provider_id,
    providerName: resolveOffice(row.provider_id)?.name ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function serve(request: Request, write: boolean) {
  const headers = new Headers();
  const send = (body: unknown, status = 200) => {
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Vary", "Cookie");
    return Response.json(body, { status, headers });
  };

  if (write && !isSameOriginRequest(request))
    return send({ error: "Cross-site requests are not permitted." }, 403);
  if (
    write &&
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    return send({ error: "Use application/json." }, 415);

  try {
    if (!isSupabaseConfigured())
      return send({ error: "Outreach requests are unavailable." }, 503);
    const client = await createClient(headers);
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError?.name === "AuthRetryableFetchError")
      return send(
        { error: "Account service is temporarily unavailable." },
        503,
      );
    if (authError || !user || user.is_anonymous)
      return send({ error: "Sign in to access outreach requests." }, 401);

    if (write) {
      let body: unknown;
      try {
        body = await readBody(request);
      } catch (error) {
        return error instanceof BodyTooLarge
          ? send({ error: "Request payload is too large." }, 413)
          : send({ error: "Invalid JSON payload." }, 400);
      }
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 3 ||
        typeof body.requestId !== "string" ||
        !UUID.test(body.requestId) ||
        typeof body.providerId !== "string" ||
        !body.providerId.length ||
        body.providerId.length > 100
      )
        return send({ error: "Invalid outreach request." }, 400);
      const brief = parseBrief(body.brief);
      if (!brief) return send({ error: "Invalid outreach brief." }, 400);
      const office = resolveOffice(body.providerId);
      if (!office) return send({ error: "Home-care office not found." }, 404);
      const requestId = body.requestId.toLowerCase();

      const { data, error } = await bookingAdmin().rpc(
        "create_outreach_request",
        {
          p_owner_id: user.id,
          p_request_id: requestId,
          p_provider_id: office.id,
          p_brief: brief,
        },
      );
      if (error?.code === "23505")
        return send(
          {
            error:
              "This request ID already has a different outreach brief or office.",
          },
          409,
        );
      if (
        error ||
        !isRecord(data) ||
        data.requestId !== requestId ||
        data.providerId !== office.id ||
        typeof data.status !== "string" ||
        typeof data.createdAt !== "string" ||
        typeof data.replayed !== "boolean"
      )
        throw new Error("Invalid outreach receipt");
      const { status, createdAt, replayed } = data;
      return send(
        { requestId, providerId: office.id, status, createdAt, replayed },
        replayed ? 200 : 201,
      );
    }

    const params = new URL(request.url).searchParams;
    const requestId = params.get("requestId");
    if (
      [...params.keys()].some((key) => key !== "requestId") ||
      params.getAll("requestId").length > 1 ||
      (requestId !== null && !UUID.test(requestId))
    )
      return send({ error: "Invalid outreach request query." }, 400);
    if (requestId === null) {
      const { data, error } = await client
        .from("outreach_requests")
        .select(REQUEST_COLUMNS)
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .order("request_id", { ascending: false })
        .limit(50);
      if (error) throw error;
      return send({ requests: data.map(serializeRequest) });
    }

    const { data, error } = await client
      .from("outreach_requests")
      .select(`${REQUEST_COLUMNS}, brief`)
      .eq("owner_id", user.id)
      .eq("request_id", requestId.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    if (!data) return send({ error: "Outreach request not found." }, 404);
    const brief = parseBrief(data.brief);
    if (!brief) throw new Error("Invalid stored outreach brief");

    const events = await client
      .from("outreach_request_events")
      .select("sequence, event_type, created_at")
      .eq("owner_id", user.id)
      .eq("request_id", requestId.toLowerCase())
      .order("sequence");
    if (events.error) throw events.error;
    return send({
      request: { ...serializeRequest(data), brief },
      events: events.data.map(({ sequence, event_type, created_at }) => ({
        sequence,
        type: event_type,
        createdAt: created_at,
      })),
    });
  } catch {
    return send(
      { error: "Outreach requests are temporarily unavailable. Please retry." },
      503,
    );
  }
}

export async function POST(request: Request) {
  return serve(request, true);
}

export async function GET(request: Request) {
  return serve(request, false);
}
