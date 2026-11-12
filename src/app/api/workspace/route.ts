import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { MAX_WORKSPACE_BYTES, validateWorkspace } from "@/lib/workspace";

import { isSameOriginRequest } from "@/lib/request-origin";

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
        { error: "Cloud workspace is not configured.", code: "NOT_CONFIGURED" },
        503,
        headers,
      ),
    };
  const client = await createClient(headers);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error?.name === "AuthRetryableFetchError")
    return {
      error: response(
        { error: "Account service is temporarily unavailable." },
        503,
        headers,
      ),
    };
  if (error || !user)
    return {
      error: response(
        { error: "Sign in to access your workspace." },
        401,
        headers,
      ),
    };
  return { client, user };
}

export async function GET() {
  const headers = new Headers();
  try {
    const auth = await authenticate(headers);
    if (auth.error) return auth.error;
    const { data, error } = await auth.client
      .from("user_workspaces")
      .select("data, updated_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error)
      return response(
        { error: "Your workspace could not be loaded. Please retry." },
        503,
        headers,
      );
    if (!data) return response({ workspace: null }, 200, headers);
    const parsed = validateWorkspace({
      ...data.data,
      updatedAt: data.updated_at,
    });
    if (!parsed.ok)
      return response(
        {
          error:
            "Saved workspace needs repair. Your data has not been overwritten.",
        },
        500,
        headers,
      );
    return response({ workspace: parsed.workspace }, 200, headers);
  } catch {
    return response(
      { error: "Your workspace could not be loaded. Please retry." },
      503,
      headers,
    );
  }
}

async function boundedBody(request: Request) {
  if (!request.body) throw new Error("EMPTY");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WORKSPACE_BYTES + 1024) {
        await reader.cancel();
        throw new Error("TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export async function PUT(request: Request) {
  const headers = new Headers();
  if (!isSameOriginRequest(request)) {
    return response(
      { error: "Cross-site workspace updates are not permitted." },
      403,
      headers,
    );
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return response({ error: "Use application/json." }, 415, headers);
  }
  try {
    const auth = await authenticate(headers);
    if (auth.error) return auth.error;
    let body: unknown;
    try {
      body = await boundedBody(request);
    } catch (error) {
      return response(
        {
          error:
            error instanceof Error && error.message === "TOO_LARGE"
              ? "Workspace payload is too large."
              : "Invalid JSON payload.",
        },
        error instanceof Error && error.message === "TOO_LARGE" ? 413 : 400,
        headers,
      );
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("workspace" in body)
    ) {
      return response({ error: "Expected { workspace }." }, 400, headers);
    }
    const parsed = validateWorkspace(body.workspace);
    if (!parsed.ok) return response({ error: parsed.error }, 400, headers);
    const workspace = {
      ...parsed.workspace,
      updatedAt: new Date().toISOString(),
    };
    const { data, error } = await auth.client
      .from("user_workspaces")
      .upsert(
        {
          user_id: auth.user.id,
          data: workspace,
          updated_at: workspace.updatedAt,
        },
        { onConflict: "user_id" },
      )
      .select("data, updated_at")
      .single();
    if (error || !data)
      return response(
        { error: "Your changes were not saved. Please retry." },
        503,
        headers,
      );
    return response(
      { workspace: { ...data.data, updatedAt: data.updated_at } },
      200,
      headers,
    );
  } catch {
    return response(
      { error: "Your changes were not saved. Please retry." },
      503,
      headers,
    );
  }
}
