import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import {
  isInquiryId,
  MAX_INQUIRY_FACTS,
  parseInquiryFact,
} from "@/lib/inquiry-facts";

export const dynamic = "force-dynamic";
function response(body: unknown, status = 200, headers = new Headers()) {
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Vary", "Cookie");
  return Response.json(body, { status, headers });
}
async function authenticate(headers: Headers) {
  if (!isSupabaseConfigured())
    return {
      error: response(
        { error: "Private facts are not configured." },
        503,
        headers,
      ),
    };
  const client = await createClient(headers);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    return {
      error: response(
        { error: "Sign in to access private facts." },
        error?.name === "AuthRetryableFetchError" ? 503 : 401,
        headers,
      ),
    };
  return { client, user };
}
export async function GET(request: Request) {
  const headers = new Headers();
  try {
    const auth = await authenticate(headers);
    if (auth.error) return auth.error;
    const requestId = new URL(request.url).searchParams.get("requestId");
    if (!isInquiryId(requestId))
      return response(
        { error: "A valid requestId is required." },
        400,
        headers,
      );
    const { data, error } = await auth.client
      .from("inquiry_facts")
      .select("fact")
      .eq("owner_id", auth.user.id)
      .eq("request_id", requestId)
      .order("created_at")
      .order("id")
      .limit(MAX_INQUIRY_FACTS);
    if (error)
      return response(
        { error: "Private facts could not be loaded. Please retry." },
        503,
        headers,
      );
    return response(
      { owner: auth.user.id, facts: (data ?? []).map((row) => row.fact) },
      200,
      headers,
    );
  } catch {
    return response(
      { error: "Private facts could not be loaded. Please retry." },
      503,
      headers,
    );
  }
}
async function boundedBody(request: Request): Promise<unknown> {
  if (!request.body) throw Error("Invalid JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        throw Error("TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
export async function POST(request: Request) {
  const headers = new Headers();
  if (!isSameOriginRequest(request))
    return response(
      { error: "Cross-site updates are not permitted." },
      403,
      headers,
    );
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return response({ error: "Use application/json." }, 415, headers);
  try {
    const auth = await authenticate(headers);
    if (auth.error) return auth.error;
    let body;
    try {
      body = await boundedBody(request);
    } catch (error) {
      return response(
        { error: "Invalid or oversized payload." },
        error instanceof Error && error.message === "TOO_LARGE" ? 413 : 400,
        headers,
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !("fact" in body) ||
      !("expectedOwner" in body) ||
      !isInquiryId(body.expectedOwner)
    )
      return response(
        { error: "Expected {expectedOwner, fact}." },
        400,
        headers,
      );
    if (body.expectedOwner !== auth.user.id)
      return response(
        {
          code: "OWNER_MISMATCH",
          error: "Your account changed. Reload before saving.",
        },
        409,
        headers,
      );
    const fact = parseInquiryFact(body.fact);
    if (!fact)
      return response({ error: "Invalid private fact." }, 400, headers);
    const { data, error } = await auth.client
      .from("inquiry_facts")
      .insert({
        owner_id: auth.user.id,
        id: fact.id,
        request_id: fact.requestId,
        provider_id: fact.providerId,
        fact,
      })
      .select("fact")
      .single();
    if (error?.code === "23505") {
      const previous = await auth.client
        .from("inquiry_facts")
        .select("fact")
        .eq("owner_id", auth.user.id)
        .eq("id", fact.id)
        .maybeSingle();
      if (previous.error || !previous.data)
        return response(
          { error: "Save could not be verified. Retry with the same fact ID." },
          503,
          headers,
        );
      const previousFact = previous.data.fact;
      const same = Object.keys(fact).every(
        (key) => previousFact[key] === fact[key as keyof typeof fact],
      );
      return same
        ? response(
            { owner: auth.user.id, fact: previous.data.fact, replayed: true },
            200,
            headers,
          )
        : response(
            {
              code: "CONFLICT",
              error:
                "This fact ID already has a different response. Reload before adding another.",
            },
            409,
            headers,
          );
    }
    if (error?.code === "23514")
      return response(
        {
          error:
            "Private fact history is full or invalid. Your previous responses are preserved.",
        },
        409,
        headers,
      );
    if (error?.code === "23503")
      return response(
        { error: "This request and agency could not be verified." },
        400,
        headers,
      );
    if (error || !data)
      return response(
        { error: "Your response was not saved. Retry with the same fact ID." },
        503,
        headers,
      );
    return response(
      { owner: auth.user.id, fact: data.fact, replayed: false },
      201,
      headers,
    );
  } catch {
    return response(
      { error: "Your response was not saved. Retry with the same fact ID." },
      503,
      headers,
    );
  }
}
