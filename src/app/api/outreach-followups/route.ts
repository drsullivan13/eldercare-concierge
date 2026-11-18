import {
  FOLLOWUP_COLUMNS,
  FOLLOWUP_UUID,
  parseFollowup,
  serializeFollowup,
} from "@/lib/outreach-followups";
import { isSameOriginRequest } from "@/lib/request-origin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
async function serve(request: Request, method: "GET" | "POST" | "PATCH") {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  });
  const send = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  if (method !== "GET" && !isSameOriginRequest(request))
    return send({ error: "Cross-site requests are not permitted." }, 403);
  if (
    method !== "GET" &&
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  )
    return send({ error: "Use application/json." }, 415);
  try {
    if (!isSupabaseConfigured())
      return send({ error: "Follow-ups unavailable." }, 503);
    const client = await createClient(headers);
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user || user.is_anonymous)
      return send({ error: "Sign in to access follow-ups." }, 401);
    if (method === "GET") {
      const params = new URL(request.url).searchParams;
      const requestId = params.get("requestId");
      if (
        [...params.keys()].some((k) => k !== "requestId") ||
        params.getAll("requestId").length > 1 ||
        (requestId !== null && !FOLLOWUP_UUID.test(requestId))
      )
        return send({ error: "Invalid query." }, 400);
      let query = client
        .from("outreach_followups")
        .select(FOLLOWUP_COLUMNS)
        .eq("owner_id", user.id);
      if (requestId) query = query.eq("request_id", requestId.toLowerCase());
      const result = await query
        .order("status", { ascending: false })
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("followup_id")
        .limit(100);
      if (result.error) throw result.error;
      return send({
        followups: result.data.map(serializeFollowup),
        serverNow: new Date().toISOString(),
      });
    }
    // Stream limit applies even without Content-Length.
    if (!request.body) return send({ error: "Missing payload." }, 400);
    const reader = request.body.getReader();
    let size = 0,
      text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body: unknown;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return send({ error: "Payload too large." }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      body = JSON.parse(text + decoder.decode());
    } catch {
      return send({ error: "Invalid JSON." }, 400);
    } finally {
      reader.releaseLock();
    }
    let result;
    if (method === "POST") {
      const b = parseFollowup(body);
      if (!b)
        return send(
          {
            error:
              "Invalid follow-up. Use human-reported attribution and an explicit due-time offset.",
          },
          400,
        );
      result = await client.rpc("record_outreach_followup", {
        p_followup_id: b.followupId,
        p_request_id: b.requestId,
        p_kind: b.kind,
        p_assignee: b.assignee,
        p_note: b.note,
        p_due_at: b.dueAt,
        p_channel: b.channel,
      });
    } else {
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("followupId" in body) ||
        typeof body.followupId !== "string" ||
        !FOLLOWUP_UUID.test(body.followupId)
      )
        return send({ error: "Invalid follow-up ID." }, 400);
      result = await client.rpc("complete_outreach_followup", {
        p_followup_id: body.followupId.toLowerCase(),
      });
    }
    if (result.error?.code === "23505")
      return send(
        { error: "Follow-up ID already used for different details." },
        409,
      );
    if (["23503", "P0002"].includes(result.error?.code ?? ""))
      return send({ error: "Request or follow-up not found." }, 404);
    if (result.error) throw result.error;
    return send(
      result.data,
      method === "POST" && !result.data.replayed ? 201 : 200,
    );
  } catch {
    return send({ error: "Follow-ups temporarily unavailable." }, 503);
  }
}
export async function GET(r: Request) {
  return serve(r, "GET");
}
export async function POST(r: Request) {
  return serve(r, "POST");
}
export async function PATCH(r: Request) {
  return serve(r, "PATCH");
}
