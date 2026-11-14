import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { OutreachRecord } from "../src/lib/outreach";
import {
  createEmptyWorkspace,
  MAX_WORKSPACE_BYTES,
} from "../src/lib/workspace";
import {
  nextWorkspaceRevision,
  parseAccountSnapshot,
} from "../src/lib/account-workspace";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");

test("actual workspace handlers enforce owner preconditions and atomic PostgreSQL revision writes", async () => {
  const db = await PGlite.create();
  await db.exec(
    "create table user_workspaces (user_id uuid primary key, data jsonb not null, updated_at timestamptz not null)",
  );
  let owner = A;
  let queries = 0;
  const auth = {
    configured: true,
    createClient: async (headers: Headers) => {
      headers.set("Set-Cookie", "refreshed=test; HttpOnly");
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: owner } }, error: null }),
        },
        from: (table: string) => {
          assert.equal(table, "user_workspaces");
          let mode = "get";
          let values: Record<string, unknown> = {};
          const filters: Record<string, unknown> = {};
          const query = {
            select: (columns: string) => {
              assert.equal(columns, "data, updated_at");
              return query;
            },
            insert: (data: Record<string, unknown>) => {
              mode = "insert";
              values = data;
              return query;
            },
            update: (data: Record<string, unknown>) => {
              mode = "update";
              values = data;
              return query;
            },
            eq: (key: string, value: unknown) => {
              filters[key] = value;
              return query;
            },
            maybeSingle: async () => {
              queries++;
              try {
                const projection =
                  "data, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"') as updated_at";
                const result =
                  mode === "insert"
                    ? await db.query(
                        `insert into user_workspaces (user_id,data,updated_at) values ($1,$2,$3) returning ${projection}`,
                        [
                          values.user_id,
                          JSON.stringify(values.data),
                          values.updated_at,
                        ],
                      )
                    : mode === "update"
                      ? await db.query(
                          `update user_workspaces set data=$1, updated_at=$2 where user_id=$3 and updated_at=$4 returning ${projection}`,
                          [
                            JSON.stringify(values.data),
                            values.updated_at,
                            filters.user_id,
                            filters.updated_at,
                          ],
                        )
                      : await db.query(
                          `select ${projection} from user_workspaces where user_id=$1`,
                          [filters.user_id],
                        );
                if (mode === "update") {
                  assert.deepEqual(Object.keys(filters).sort(), [
                    "updated_at",
                    "user_id",
                  ]);
                  assert.equal(filters.user_id, owner);
                }
                return { data: result.rows[0] || null, error: null };
              } catch (error) {
                return { data: null, error };
              }
            },
          };
          return query;
        },
      };
    },
  };
  const bundle = await build({
    entryPoints: [resolve("src/app/api/workspace/route.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "authenticated-test-client",
        setup(builder: {
          onResolve: (options: object, callback: () => object) => void;
          onLoad: (options: object, callback: () => object) => void;
        }) {
          builder.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
            path: "auth",
            namespace: "test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const isSupabaseConfigured=()=>__auth.configured; export const createClient=(headers)=>__auth.createClient(headers);",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports: {} as {
      GET: () => Promise<Response>;
      PUT: (request: Request) => Promise<Response>;
    },
  };
  new Function("__auth", "module", "exports", bundle.outputFiles[0].text)(
    auth,
    bundled,
    bundled.exports,
  );
  const { GET, PUT } = bundled.exports;
  const outreach = Array.from({ length: 32 }, (_, index): OutreachRecord => ({
    brief: {
      providerId: `care-office-${index + 1}`,
      providerName: `Example Care Office ${index + 1}`,
      phone: "+12015550100",
      requestId: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
      readKey: "a".repeat(64),
      topics: ["availability", "care assessment", "costs", "transportation"],
      question:
        "Please explain the assessment process, current weekday availability, minimum visit length, transportation arrangements, and written pricing. We are comparing options before choosing a provider and have not authorized an enrollment or a paid service.",
      previous:
        "The prior inquiry established that this office accepts new assessments but could not confirm a start date. The family requested written information about supervision, backup staffing, medication reminders, and accessibility. Please distinguish office policy from services that require an individual assessment. No care arrangement has been agreed and the family still needs to review the proposed schedule and service agreement.",
    },
    createdAt: "2026-11-13T09:00:00.000Z",
    updatedAt: "2026-11-13T09:20:00.000Z",
    state: "completed",
    findings: [
      "The intake coordinator described an initial telephone screening followed by an in-person assessment. The assessment determines whether the requested support can be offered safely; this conversation did not establish eligibility or approve services.",
      "Weekday morning visits may be available, but the office cannot reserve a caregiver until the assessment and scheduling review are complete. The coordinator asked the family to provide two alternative start dates and explain any inflexible appointments.",
      "The office normally schedules a minimum four-hour visit. Shorter visits require a separate scheduling review and may not be available in every neighborhood. The coordinator will include the minimum visit policy in the written information packet.",
      "Medication reminders were described as a possible non-clinical service when permitted by the care plan. Medication administration requires separate clinical review. The family should not treat the intake conversation as approval for either service.",
      "Backup coverage is coordinated through the scheduling team when a regular caregiver is unavailable. The coordinator could not guarantee a substitute for every shift and recommended reviewing the cancellation and missed-visit policies before signing.",
      "Pricing depends on the assessed level of support, visit duration, and schedule. The office did not provide a binding quotation during this inquiry. Weekend and holiday rates may differ and should be listed separately in the written estimate.",
      "Transportation can sometimes accompany a scheduled visit, subject to driver availability and the office vehicle policy. Mileage, parking, and waiting time may be billed separately. Accessible transportation was not confirmed during the conversation.",
      "The intake packet includes consent forms, emergency contact details, a service agreement, and information about complaints. The family can request an accessible copy and review the documents before deciding whether to proceed with an assessment.",
      "The office described a supervisor contact for care-plan questions during business hours and a separate after-hours scheduling number. Neither contact replaces emergency services. Written escalation instructions are still needed for the family's records.",
      "Insurance coverage and reimbursement were not verified. The coordinator recommended asking the insurer about authorization, eligible services, and required documentation. The family remains responsible for confirming benefits before accepting paid support.",
      "A home access review will consider stairs, bathroom layout, mobility equipment, and safe entry arrangements. The family should describe these conditions during assessment rather than assuming that the current staffing plan can accommodate every need.",
      "The coordinator can arrange a follow-up discussion after the assessment documents are reviewed. No appointment, caregiver assignment, price guarantee, or enrollment resulted from this conversation. All proposed arrangements remain subject to family approval.",
    ],
    nextSteps: [
      "Request the written intake packet and review the service agreement, cancellation terms, complaint process, and minimum visit requirements before choosing an assessment date.",
      "Ask scheduling to confirm availability for two possible weekday morning start dates and explain whether a consistent caregiver can be assigned across those visits.",
      "Prepare a description of mobility support, medication reminders, stairs, bathroom access, and emergency contacts for the assessment without sending unrelated medical records.",
      "Obtain an itemized estimate that separates hourly care, assessment charges, weekend rates, transportation mileage, parking, and any minimum weekly commitment.",
      "Confirm reimbursement requirements directly with the insurer and ask which authorizations and documents are required before the first paid service can take place.",
      "Discuss the backup coverage policy with the scheduling supervisor, including how the family is notified and what happens when no replacement caregiver is available.",
      "Ask for written transportation and accessibility policies, including whether an accessible vehicle can be arranged and who is responsible for accompanying the person.",
      "Compare the written answers with other shortlisted offices and discuss unresolved questions with the family before authorizing an assessment or signing a service agreement.",
    ],
    activity: [
      { state: "opened", at: "2026-11-13T09:01:00.000Z" },
      { state: "failed", at: "2026-11-13T09:02:00.000Z" },
      { state: "connected", at: "2026-11-13T09:05:00.000Z" },
      { state: "completed", at: "2026-11-13T09:20:00.000Z" },
    ],
    commitments: [
      {
        kind: "scheduled",
        text: "A follow-up telephone discussion is scheduled for Monday morning to review the intake packet. This is not a scheduled care visit or an enrollment.",
      },
      {
        kind: "agreed",
        text: "The intake coordinator agreed to send written service policies and an itemized estimate for family review before requesting any signed service agreement.",
      },
      {
        kind: "proposed",
        text: "The office proposed an in-person assessment after the family reviews the packet. The family has not accepted a date or authorized a paid assessment.",
      },
      {
        kind: "cancelled",
        text: "The earlier proposed afternoon callback was cancelled because it conflicted with a family appointment. The replacement discussion does not reserve a caregiver.",
      },
    ],
  }));
  const workspace = { ...createEmptyWorkspace(), outreach };
  const historyBytes = Buffer.byteLength(JSON.stringify(workspace));
  assert.ok(
    historyBytes > 128 * 1024,
    "legitimate history exceeds the old cap",
  );
  const put = (body: unknown, headers = {}) =>
    PUT(
      new Request("https://harbor.test/api/workspace", {
        method: "PUT",
        headers: {
          Origin: "https://harbor.test",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    const missing = await GET();
    assert.deepEqual(await missing.json(), {
      owner: A,
      revision: null,
      workspace: null,
    });
    assert.match(missing.headers.get("cache-control")!, /no-store/);
    assert.equal(missing.headers.get("vary"), "Cookie");
    assert.match(missing.headers.get("set-cookie")!, /refreshed/);
    for (const body of [
      { workspace },
      { workspace, expectedOwner: A },
      { workspace, expectedOwner: A, expectedRevision: "" },
      { workspace, expectedOwner: "bad", expectedRevision: null },
      { workspace, expectedOwner: A, expectedRevision: "2026-02-30T00:00:00Z" },
      { workspace, expectedOwner: A, expectedRevision: null, unexpected: true },
    ])
      assert.equal((await put(body)).status, 400);
    assert.equal(
      (
        await put(
          { workspace, expectedOwner: A, expectedRevision: null },
          { Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await put(
          { workspace, expectedOwner: A, expectedRevision: null },
          { "Content-Type": "text/plain" },
        )
      ).status,
      415,
    );
    assert.equal(
      (
        await put({
          workspace: {
            ...workspace,
            notes: { p: "x".repeat(MAX_WORKSPACE_BYTES + 2048) },
          },
          expectedOwner: A,
          expectedRevision: null,
        })
      ).status,
      413,
    );
    const firstRace = await Promise.all([
      put({ workspace, expectedOwner: A, expectedRevision: null }),
      put({ workspace, expectedOwner: A, expectedRevision: null }),
    ]);
    assert.deepEqual(
      firstRace.map((result) => result.status).sort(),
      [200, 409],
    );
    const first = parseAccountSnapshot(
      await firstRace.find((result) => result.status === 200)!.json(),
    );
    assert.equal(
      (await firstRace.find((result) => result.status === 409)!.json()).code,
      "CONFLICT",
    );
    const future = "2099-01-01T00:00:00.123456+00:00";
    await db.query(
      "update user_workspaces set updated_at=$1 where user_id=$2",
      [future, A],
    );
    const loaded = parseAccountSnapshot(await (await GET()).json());
    assert.equal(loaded.revision, future);
    const next = await Promise.all(
      ["one", "two"].map((name) =>
        put({
          workspace: { ...workspace, profile: { ...workspace.profile, name } },
          expectedOwner: A,
          expectedRevision: loaded.revision,
        }),
      ),
    );
    assert.deepEqual(next.map((result) => result.status).sort(), [200, 409]);
    const saved = parseAccountSnapshot(
      await next.find((result) => result.status === 200)!.json(),
    );
    assert.deepEqual(saved.workspace!.outreach, outreach);
    assert.equal(saved.revision, "2099-01-01T00:00:00.123457+00:00");
    assert.equal(saved.workspace!.updatedAt, saved.revision);
    assert.notEqual(first.revision, saved.revision);
    owner = B;
    const before = queries;
    const wrongOwner = await put({
      workspace,
      expectedOwner: A,
      expectedRevision: saved.revision,
    });
    assert.equal(wrongOwner.status, 409);
    assert.equal((await wrongOwner.json()).code, "OWNER_MISMATCH");
    assert.equal(queries, before);
    assert.deepEqual(await (await GET()).json(), {
      owner: B,
      revision: null,
      workspace: null,
    });
    const impersonatedRevision = await put({
      workspace,
      expectedOwner: B,
      expectedRevision: saved.revision,
    });
    assert.equal(impersonatedRevision.status, 409);
    assert.equal((await impersonatedRevision.json()).code, "CONFLICT");
    assert.deepEqual(await (await GET()).json(), {
      owner: B,
      revision: null,
      workspace: null,
    });
    owner = A;
    const restored = parseAccountSnapshot(await (await GET()).json());
    assert.deepEqual(restored, saved);
    assert.deepEqual(restored.workspace!.outreach, outreach);
    const oversizedResult = await put({
      workspace: {
        ...saved.workspace,
        outreach: [
          {
            ...outreach[0],
            findings: ["x".repeat(1201)],
          },
          ...outreach.slice(1),
        ],
      },
      expectedOwner: A,
      expectedRevision: saved.revision,
    });
    assert.equal(oversizedResult.status, 400);
    assert.deepEqual(await (await GET()).json(), saved);
    const oversizedBody = await put({
      workspace: {
        ...saved.workspace,
        notes: { p: "x".repeat(MAX_WORKSPACE_BYTES + 2048) },
      },
      expectedOwner: A,
      expectedRevision: saved.revision,
    });
    assert.equal(oversizedBody.status, 413);
    assert.deepEqual(await (await GET()).json(), saved);
    assert.equal(
      (
        await put({
          workspace,
          expectedOwner: A,
          expectedRevision: new Date(future).toISOString(),
        })
      ).status,
      409,
    );
    assert.deepEqual(await (await GET()).json(), saved);
  } finally {
    await db.close();
  }
});

test("revision generation advances within one millisecond and beyond future microsecond tokens", () => {
  const now = Date.parse("2026-11-13T00:00:00.123Z");
  assert.equal(nextWorkspaceRevision(null, now), "2026-11-13T00:00:00.123000Z");
  assert.equal(
    nextWorkspaceRevision("2026-11-13T00:00:00.123000+00:00", now),
    "2026-11-13T00:00:00.123001Z",
  );
  assert.equal(
    nextWorkspaceRevision("2099-01-01T00:00:00.999999Z", now),
    "2099-01-01T00:00:01.000000Z",
  );
  assert.equal(
    nextWorkspaceRevision("2099-01-01T01:00:00.123456+01:00", now),
    "2099-01-01T00:00:00.123457Z",
  );
  assert.throws(() =>
    parseAccountSnapshot({
      owner: A,
      revision: null,
      workspace: createEmptyWorkspace(),
    }),
  );
});
