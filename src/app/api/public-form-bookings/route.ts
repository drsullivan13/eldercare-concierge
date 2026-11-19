import { PayloadTooLarge, readBoundedJson } from "@/lib/read-bounded-json";
import { isSameOriginRequest } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";
import {
  publicFormProvider,
  publicFormRebookable,
} from "@/lib/public-form-providers";

export const dynamic = "force-dynamic";
const FIELDS =
  "id,status,windowStart:window_start,windowEnd:window_end,startTime:start_time,receipt";
const APPROVAL_KEYS = [
  "action",
  "providerId",
  "requestId",
  "windowStart",
  "windowEnd",
  "name",
  "phone",
  "consentVersion",
  "expectedEmail",
];
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function approval(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).length !== APPROVAL_KEYS.length ||
    !APPROVAL_KEYS.every((k) => Object.hasOwn(body, k))
  )
    return;
  const {
    action,
    providerId,
    requestId,
    windowStart,
    windowEnd,
    name,
    phone,
    consentVersion,
    expectedEmail,
  } = body;
  const office =
    typeof providerId === "string" ? publicFormProvider(providerId) : undefined;
  if (
    action !== "bookWindow" ||
    !office ||
    typeof requestId !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      requestId,
    ) ||
    typeof windowStart !== "string" ||
    !INSTANT.test(windowStart) ||
    typeof windowEnd !== "string" ||
    !INSTANT.test(windowEnd) ||
    typeof name !== "string" ||
    name.length > 100 ||
    !/\S+\s+\S+/.test(name.trim()) ||
    typeof phone !== "string" ||
    phone.length > 24 ||
    consentVersion !== office.consentVersion ||
    typeof expectedEmail !== "string"
  )
    return;
  const digits = phone.replace(/[- ().]/g, "");
  if (!/^(?:\+?1)?[2-9]\d{9}$/.test(digits)) return;
  return {
    p_request_id: requestId,
    p_provider_id: office.providerId,
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_name: name.trim(),
    p_phone: "+1" + digits.slice(-10),
    p_consent_version: consentVersion,
    p_expected_email: expectedEmail,
  };
}

async function serve(req: Request, write: boolean) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  });
  const send = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  if (write && !isSameOriginRequest(req))
    return send({ error: "Cross-site request refused." }, 403);
  const params = new URL(req.url).searchParams;
  const office = publicFormProvider(params.get("providerId") ?? "");
  const prefill = !write && params.get("prefill") === "1";
  if (write ? params.size !== 0 : params.size !== (prefill ? 2 : 1) || !office)
    return send({ error: "Invalid booking scope." }, 400);
  if (
    write &&
    req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
  )
    return send({ error: "Use application/json." }, 415);
  try {
    const client = await createClient(headers);
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return send({ error: "Sign in to book for your family." }, 401);
    if (user.is_anonymous || !user.email_confirmed_at || !user.email)
      return send({ error: "A verified account email is required." }, 403);
    if (!write && office) {
      const { data, error } = await client
        .from("public_form_bookings")
        .select(FIELDS)
        .eq("owner_id", user.id)
        .eq("provider_id", office.providerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (prefill && publicFormRebookable(data, office, Date.now())) {
        const { data: defaults, error } = await client.rpc(
          "public_form_booking_defaults",
          { p_provider_id: office.providerId },
        );
        if (error) throw error;
        return send({ email: user.email, job: data, defaults });
      }
      return send({ email: user.email, job: data });
    }
    let body: unknown;
    try {
      body = await readBoundedJson(req, 4096);
    } catch (error) {
      return send(
        { error: "Invalid or oversized booking approval." },
        error instanceof PayloadTooLarge ? 413 : 400,
      );
    }
    const args = approval(body);
    if (!args)
      return send(
        {
          error:
            "Check the office, time window, approved terms and contact details.",
        },
        400,
      );
    if (args.p_expected_email !== user.email)
      return send(
        { error: "Your signed-in email changed. Refresh before booking." },
        409,
      );
    const { data, error } = await client.rpc(
      "request_public_form_booking",
      args,
    );
    if (error) {
      if (error.code === "P0429")
        return send({ error: "Hourly booking limit reached." }, 429);
      if (error.code === "42501")
        return send({ error: "Verify your account before booking." }, 403);
      if (error.code === "23505" || error.code === "55000")
        return send(
          {
            error:
              "Review your latest booking and account details before trying again.",
          },
          409,
        );
      if (["22023", "22007", "22008"].includes(error.code))
        return send(
          {
            error:
              "Choose a future window of 30 minutes to seven days, ending within 31 days.",
          },
          400,
        );
      throw error;
    }
    return send({ email: user.email, job: data });
  } catch {
    return send(
      {
        error:
          "Harbor could not read your booking status. Refresh before trying again.",
      },
      503,
    );
  }
}
export const GET = (request: Request) => serve(request, false);
export const POST = (request: Request) => serve(request, true);
