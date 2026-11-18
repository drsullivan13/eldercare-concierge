import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const owner = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const bookingId = "33333333-3333-4333-8333-333333333333";
const providerId = "north-jersey-hp-hp0000216";

test("real booking API checks explicit account/office before actions and rejects replay retargeting", async () => {
  let matchingRequest = false,
    link: string | null = requestId,
    inserts = 0;
  const filters = new Map<string, unknown>();
  const booking = {
    id: bookingId,
    provider_id: providerId,
    status: "unknown",
    outreach_request_id: requestId,
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: owner,
            email: "test@example.invalid",
            email_confirmed_at: "2026-01-01",
          },
        },
      }),
    },
    from(table: string) {
      filters.clear();
      const query = {
        select: () => query,
        eq(key: string, value: unknown) {
          filters.set(key, value);
          return query;
        },
        in: () => query,
        lte: () => query,
        lt: () => query,
        update: () => query,
        then(resolve: (result: unknown) => unknown) {
          return Promise.resolve(resolve({ error: null }));
        },
        insert() {
          inserts++;
          return { error: { code: "23505" } };
        },
        maybeSingle() {
          if (table === "outreach_requests") {
            assert.equal(filters.get("owner_id"), owner);
            assert.equal(filters.get("provider_id"), providerId);
            assert.equal(filters.get("request_id"), requestId);
            return { data: matchingRequest ? { request_id: requestId } : null };
          }
          assert.equal(filters.get("user_id"), owner);
          assert.equal(filters.get("provider_id"), providerId);
          assert.equal(filters.get("id"), bookingId);
          return { data: { ...booking, outreach_request_id: link } };
        },
      };
      return query;
    },
  };
  const bundle = await build({
    entryPoints: ["src/app/api/consultations/route.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "safe-booking-test",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^@\/lib\/(supabase\/(server|booking-admin)|consultation-config|phone-consultation|consultation-invite)$/,
            },
            ({ path }) => ({ namespace: "test", path }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents: path.endsWith("/server")
              ? "export const createClient=()=>client;"
              : path.endsWith("booking-admin")
                ? "export const bookingAdmin=()=>client;"
                : path.endsWith("consultation-config")
                  ? "export const consultationConfig=()=>({source:'calendly', slots:()=>{throw Error('external action forbidden')},book:()=>{throw Error('external action forbidden')}});export const publicBookingUrl=()=>null;"
                  : path.endsWith("phone-consultation")
                    ? "export const phoneConsultationConfigured=()=>false;export const consultationPhone=()=>false;export const startPhoneConsultation=()=>{throw Error('external action forbidden')};"
                    : "export const deliverConsultationInvite=()=>{throw Error('external action forbidden')};",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports: {} as typeof import("../src/app/api/consultations/route"),
  };
  new Function(
    "require",
    "client",
    "module",
    "exports",
    bundle.outputFiles[0].text,
  )(require, client, bundled, bundled.exports);
  const post = () =>
    bundled.exports.POST(
      new Request("https://harbor.example/api/consultations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://harbor.example",
        },
        body: JSON.stringify({
          requestId: bookingId,
          outreachRequestId: requestId,
          providerId,
          name: "Family",
          timezone: "America/New_York",
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 90000000).toISOString(),
        }),
      }),
    );
  assert.equal((await post()).status, 404);
  assert.equal(inserts, 0);
  matchingRequest = true;
  assert.deepEqual((await (await post()).json()).booking, {
    id: bookingId,
    provider_id: providerId,
    status: "unknown",
  });
  assert.equal(inserts, 1);
  link = null;
  assert.equal((await post()).status, 409);
  link = crypto.randomUUID();
  assert.equal((await post()).status, 409);
});

test("timeline route scopes both lookups and bounds its safe verified projection", async () => {
  let signedIn = true,
    found = true;
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: signedIn ? { id: owner } : null },
      }),
    },
    from(table: string) {
      const filters = new Map<string, unknown>();
      const query = {
        select: () => query,
        eq(key: string, value: unknown) {
          filters.set(key, value);
          return query;
        },
        order: () => query,
        maybeSingle() {
          assert.equal(table, "outreach_requests");
          assert.equal(filters.get("owner_id"), owner);
          assert.equal(filters.get("request_id"), requestId);
          return { data: found ? { provider_id: providerId } : null };
        },
        limit(max: number) {
          assert.equal(table, "consultation_bookings");
          assert.equal(max, 10);
          assert.equal(filters.get("user_id"), owner);
          assert.equal(filters.get("outreach_request_id"), requestId);
          assert.equal(filters.get("provider_id"), providerId);
          return {
            data: [
              {
                id: bookingId,
                provider_id: providerId,
                status: "unknown",
                source: "phone",
                starts_at: "tentative",
                ends_at: null,
                timezone: "America/New_York",
                created_at: "2026-11-18",
                call_sid: "private",
              },
            ],
          };
        },
      };
      return query;
    },
  };
  const bundle = await build({
    entryPoints: ["src/app/api/outreach-bookings/route.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "timeline-test",
        setup(builder) {
          builder.onResolve(
            { filter: /^@\/lib\/supabase\/server$/ },
            ({ path }) => ({ namespace: "test", path }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const createClient=()=>client;export const isSupabaseConfigured=()=>true;",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports: {} as typeof import("../src/app/api/outreach-bookings/route"),
  };
  new Function(
    "require",
    "client",
    "module",
    "exports",
    bundle.outputFiles[0].text,
  )(require, client, bundled, bundled.exports);
  const get = (query = `requestId=${requestId}`) =>
    bundled.exports.GET(
      new Request(`https://harbor.example/api/outreach-bookings?${query}`),
    );
  const response = await get();
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  const result = (await response.json()).bookings[0];
  assert.equal(result.startsAt, null);
  assert.equal(result.nextAction, "wait_for_receipt");
  assert.equal("call_sid" in result, false);
  found = false;
  assert.equal((await get()).status, 404);
  signedIn = false;
  assert.equal((await get()).status, 401);
  assert.equal(
    (await get(`requestId=${requestId}&providerId=other`)).status,
    400,
  );
});
