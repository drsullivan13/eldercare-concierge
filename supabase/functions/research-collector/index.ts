import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  workerTicketHash,
  collectCms,
  collectYelpIdentifiers,
  type CollectionOutcome,
  type ProviderIdentity,
} from "../_shared/research-collectors.ts";

type Job = {
  job_id: string;
  lease_token: string;
  source_key: string;
  provider_id: string | null;
  connector: string;
  collection_scope: string;
  config: Record<string, unknown>;
  source_last_snapshot_hash: string | null;
};
function serverKey(): string | undefined {
  // Supabase supplies this only to its server runtime. It never enters Vercel/client code.
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
  } catch {
    return undefined;
  }
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const tokenHash = await workerTicketHash(req.headers.get("Authorization"));
  if (!tokenHash) return json({ error: "UNAUTHORIZED" }, 401);
  if (Number(req.headers.get("Content-Length") || 0) > 1024)
    return json({ error: "REQUEST_TOO_LARGE" }, 413);
  let operation = "run";
  try {
    const reader = req.body?.getReader();
    let size = 0;
    let body = "";
    const decoder = new TextDecoder();
    if (reader)
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return json({ error: "REQUEST_TOO_LARGE" }, 413);
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
    body += decoder.decode();
    const input = body ? JSON.parse(body) : {};
    if (
      !input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      Object.keys(input).some((key) => key !== "operation") ||
      (input.operation !== undefined &&
        !["run", "status"].includes(input.operation))
    )
      return json({ error: "INVALID_REQUEST" }, 400);
    operation = input.operation || "run";
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  const key = serverKey();
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) return json({ error: "SERVER_CONFIGURATION_MISSING" }, 503);
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const worker = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const ticket = await db.rpc("harbor_research_consume_worker_ticket", {
      token_hash: tokenHash,
      operation,
    });
    if (ticket.error) return json({ error: "AUTHORIZATION_UNAVAILABLE" }, 503);
    if (ticket.data !== true) return json({ error: "UNAUTHORIZED" }, 401);
    if (operation === "status") {
      const { data, error } = await db.rpc("harbor_research_status");
      if (error) return json({ error: "STATUS_UNAVAILABLE" }, 503);
      return json({
        ...data,
        credentials: {
          yelp_api_key_configured: Boolean(Deno.env.get("YELP_API_KEY")),
          yelp_client_id_configured: Boolean(Deno.env.get("YELP_CLIENT_ID")),
        },
      });
    }
    const enqueue = await db.rpc("harbor_research_enqueue_due_jobs");
    if (enqueue.error) return json({ error: "ENQUEUE_FAILED" }, 503);
    const results: { source: string; status: string; error_code?: string }[] =
      [];
    async function reserve(connector: "cms" | "yelp"): Promise<boolean> {
      const { data, error } = await db.rpc("harbor_research_reserve_budget", {
        connector,
        request_count: 1,
      });
      if (error) throw new Error("BUDGET_UNAVAILABLE");
      return data?.reserved === true;
    }
    for (let i = 0; i < 3 && Date.now() - startedAt < 65_000; i++) {
      const claim = await db.rpc("harbor_research_claim_jobs", {
        worker_id: worker,
        limit_count: 1,
      });
      if (claim.error)
        return json({ error: "CLAIM_FAILED", processed: results.length }, 503);
      const job = (claim.data as Job[] | null)?.[0];
      if (!job) break;
      let outcome: CollectionOutcome;
      try {
        if (
          job.connector === "cms" &&
          job.collection_scope === "official_public_data"
        ) {
          outcome = (await reserve("cms"))
            ? await collectCms(job.config, job.source_last_snapshot_hash)
            : {
                status: "retry",
                error_code: "CMS_DAILY_BUDGET_REACHED",
                retry_after_seconds: 86400,
              };
        } else if (
          job.connector === "yelp" &&
          job.collection_scope === "identifiers_capability_only"
        ) {
          const identity = job.config.identity as ProviderIdentity | undefined;
          outcome = identity
            ? await collectYelpIdentifiers(
                identity,
                Deno.env.get("YELP_API_KEY"),
                () => reserve("yelp"),
              )
            : { status: "blocked", error_code: "YELP_IDENTITY_INPUT_REVIEW" };
        } else
          outcome = {
            status: "blocked",
            error_code: "COLLECTION_SCOPE_NOT_ENABLED",
          };
      } catch {
        outcome = {
          status: "retry",
          error_code: "COLLECTOR_INTERNAL_ERROR",
          retry_after_seconds: 300,
        };
      }
      const completed = await db.rpc("harbor_research_complete_job", {
        job_id: job.job_id,
        lease_token: job.lease_token,
        outcome,
      });
      if (completed.error) {
        // The lease expires and can be reclaimed. Never claim this observation was saved.
        results.push({
          source: job.source_key,
          status: "completion_failed",
          error_code: "COMPLETION_FAILED",
        });
        break;
      }
      results.push({
        source: job.source_key,
        status: completed.data.status,
        ...(outcome.error_code ? { error_code: outcome.error_code } : {}),
      });
    }
    return json({
      worker,
      enqueued: enqueue.data,
      processed: results.length,
      results,
    });
  } catch {
    return json({ error: "WORKER_UNAVAILABLE" }, 503);
  }
});
