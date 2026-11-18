import {
  isReceiptId,
  isRehearsalReceipt,
  parseReceiptCursor,
} from "@/lib/outreach-rehearsal-receipt";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export async function GET(request: Request) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  });
  const send = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const unavailable = () =>
    send(
      { error: "Simulated rehearsal reports are temporarily unavailable." },
      503,
    );

  const params = new URL(request.url).searchParams;
  const requestId = params.get("requestId");
  const before = params.get("before");
  const cursor = before === null ? null : parseReceiptCursor(before);
  if (
    !isReceiptId(requestId) ||
    [...params.keys()].some((key) => key !== "requestId" && key !== "before") ||
    params.getAll("requestId").length !== 1 ||
    params.getAll("before").length > 1 ||
    (before !== null && !cursor)
  )
    return send({ error: "Invalid rehearsal report query." }, 400);

  try {
    if (!isSupabaseConfigured()) return unavailable();
    const client = await createClient(headers);
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError?.name === "AuthRetryableFetchError") return unavailable();
    if (authError || !user || user.is_anonymous)
      return send(
        { error: "Sign in to view simulated rehearsal reports." },
        401,
      );

    const ownedRequestId = requestId.toLowerCase();
    let query = client
      .from("outreach_rehearsal_receipts")
      .select("run_id, request_id, outcome, created_at")
      .eq("owner_id", user.id)
      .eq("request_id", ownedRequestId);

    if (cursor) {
      const { createdAt, runId } = cursor;
      // Both cursor components have been validated against strict formats.
      query = query.or(
        `created_at.lt.${createdAt},and(created_at.eq.${createdAt},run_id.lt.${runId})`,
      );
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("run_id", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (error) return unavailable();

    const receipts = data
      .slice(0, PAGE_SIZE)
      .map(({ run_id, request_id, outcome, created_at }) => ({
        runId: run_id,
        requestId: request_id,
        outcome,
        createdAt: created_at,
      }));
    if (
      !receipts.every(
        (receipt) =>
          isRehearsalReceipt(receipt) && receipt.requestId === ownedRequestId,
      )
    )
      return unavailable();
    const last = receipts.at(-1);
    return send({
      receipts,
      nextCursor:
        data.length > PAGE_SIZE && last
          ? `${last.createdAt}|${last.runId}`
          : null,
    });
  } catch {
    return unavailable();
  }
}
