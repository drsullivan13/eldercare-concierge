import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const offices = [
  {
    providerId: "north-jersey-hp-hp0265900",
    consentVersion: "elderly-savior-v1",
  },
  { providerId: "north-jersey-hp-hp0054400", consentVersion: "wellcare-v1" },
];
const email = "ada@example.test",
  id = "00000000-0000-4000-8000-000000000001";
for (const { providerId, consentVersion } of offices) {
  test(`public-form route scopes ${providerId} reads and approved terms to the account and office`, async () => {
    let verified = true;
    let anonymous = false;
    let signedIn = true;
    const job = {
      id,
      status: "queued_booking",
      windowStart: "2027-02-01T16:00:00Z",
      windowEnd: "2027-02-01T18:00:00Z",
      startTime: null as string | null,
      receipt: null,
    };
    const defaults = {
      name: "Ada Doe",
      phone: "+12025550101",
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
    };
    const otherOffice = offices.find(
      (office) => office.providerId !== providerId,
    )!;
    const otherJob = {
      ...job,
      id: "other-job",
      status: "pending",
      receipt: "Other office receipt",
    };
    let defaultReads = 0;
    const writes: Record<string, unknown>[] = [];
    let dbError: string | null = null;
    const filters: Record<string, string> = {};
    const query = {
      select: (s: string) => {
        assert.doesNotMatch(s, /phone|email|invitee/);
        return query;
      },
      eq: (k: string, v: string) => {
        filters[k] = v;
        return query;
      },
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({
        data: filters.provider_id === providerId ? job : otherJob,
        error: null,
      }),
    };
    const mock = {
      async createClient(headers: Headers) {
        headers.set("Set-Cookie", "fresh=test; HttpOnly");
        return {
          auth: {
            getUser: async () => ({
              data: {
                user: signedIn
                  ? {
                      id: "owner",
                      email,
                      is_anonymous: anonymous,
                      email_confirmed_at: verified
                        ? new Date().toISOString()
                        : null,
                    }
                  : null,
              },
              error: null,
            }),
          },
          from: (table: string) => {
            assert.equal(table, "public_form_bookings");
            return query;
          },
          rpc: async (name: string, args: Record<string, unknown>) => {
            if (name === "public_form_booking_defaults") {
              assert.deepEqual(args, { p_provider_id: providerId });
              defaultReads++;
              return { data: defaults, error: null };
            }
            assert.equal(name, "request_public_form_booking");
            writes.push(args);
            return { data: job, error: dbError ? { code: dbError } : null };
          },
        };
      },
    };
    const bundle = await build({
      entryPoints: ["src/app/api/public-form-bookings/route.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      plugins: [
        {
          name: "public-booking-auth",
          setup(b: {
            onResolve: (o: object, c: () => object) => void;
            onLoad: (o: object, c: () => object) => void;
          }) {
            b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
              path: "auth",
              namespace: "mock",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
              contents: "export const createClient=__auth.createClient;",
            }));
          },
        },
      ],
    });
    const routeModule = {
      exports: {} as typeof import("../src/app/api/public-form-bookings/route"),
    };
    new Function("__auth", "module", "exports", bundle.outputFiles[0].text)(
      mock,
      routeModule,
      routeModule.exports,
    );
    const url = "https://harbor.test/api/public-form-bookings";
    const { GET, POST } = routeModule.exports;
    const payload = {
      action: "bookWindow",
      providerId,
      requestId: id,
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      name: "Ada Doe",
      phone: "(202) 555-0101",
      expectedEmail: email,
      consentVersion,
    };
    const post = (
      patch: Record<string, unknown> = {},
      origin = "https://harbor.test",
    ) =>
      POST(
        new Request(url, {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, ...patch }),
        }),
      );
    const read = await GET(new Request(url + "?providerId=" + providerId));
    assert.match(read.headers.get("Cache-Control") ?? "", /private, no-store/);
    assert.ok(read.headers.get("Set-cookie"));
    assert.deepEqual(await read.json(), { email, job });
    assert.deepEqual(filters, { owner_id: "owner", provider_id: providerId });
    assert.deepEqual(
      await (
        await GET(
          new Request(
            url + "?providerId=" + otherOffice.providerId + "&prefill=1",
          ),
        )
      ).json(),
      { email, job: otherJob },
      "An unresolved outcome for another office does not read this office's defaults",
    );
    assert.deepEqual(filters, {
      owner_id: "owner",
      provider_id: otherOffice.providerId,
    });
    for (const query of [
      "",
      "?providerId=unknown",
      `?providerId=${providerId}&providerId=${otherOffice.providerId}`,
      `?providerId=${providerId}&prefill=0`,
      `?providerId=${providerId}&prefill=1&ownerId=foreign`,
    ])
      assert.equal((await GET(new Request(url + query))).status, 400);
    const readSetup = () =>
      GET(new Request(url + "?providerId=" + providerId + "&prefill=1"));
    assert.deepEqual(await (await readSetup()).json(), { email, job });
    assert.equal(defaultReads, 0);
    job.status = "failed";
    assert.deepEqual(await (await readSetup()).json(), {
      email,
      job,
      defaults,
    });
    assert.deepEqual(
      await (await GET(new Request(url + "?providerId=" + providerId))).json(),
      { email, job },
    );
    assert.equal(defaultReads, 1);
    job.status = "confirmed";
    job.startTime = new Date(Date.now() - 29 * 60_000).toISOString();
    assert.deepEqual(await (await readSetup()).json(), { email, job });
    assert.equal(
      defaultReads,
      1,
      "A 30-minute appointment is not over after 29 minutes",
    );
    job.startTime = new Date(Date.now() - 30 * 60_000).toISOString();
    assert.deepEqual(await (await readSetup()).json(), {
      email,
      job,
      defaults,
    });
    assert.equal(defaultReads, 2);
    job.startTime = null;
    job.status = "queued_booking";
    assert.equal((await post({}, "https://evil.test")).status, 403);
    verified = false;
    assert.equal((await post()).status, 403);
    verified = true;
    anonymous = true;
    assert.equal((await post()).status, 403);
    anonymous = false;
    signedIn = false;
    assert.equal((await post()).status, 401);
    signedIn = true;
    assert.equal((await post({ ownerId: "foreign" })).status, 400);
    assert.equal((await post({ providerId: "unknown" })).status, 400);
    assert.equal(
      (await post({ consentVersion: otherOffice.consentVersion })).status,
      400,
    );
    assert.equal(
      (await post({ providerId: otherOffice.providerId })).status,
      400,
    );
    assert.equal(
      (await post({ phone: " ".repeat(25) + "2025550101" })).status,
      400,
    );
    assert.equal(
      (await post({ expectedEmail: "foreign@example.test" })).status,
      409,
    );
    assert.equal(
      (await post({ windowEnd: "2027-02-01T18:00:00" })).status,
      400,
    );
    assert.equal((await post({ name: "a".repeat(5000) })).status, 413);
    assert.equal(writes.length, 0);
    assert.deepEqual(await (await post()).json(), { email, job });
    assert.equal(writes[0].p_phone, "+12025550101");
    assert.equal(writes[0].p_provider_id, providerId);
    assert.equal(writes[0].p_consent_version, consentVersion);
    assert.equal(writes[0].p_expected_email, email);
    for (const [code, status] of [
      ["P0429", 429],
      ["55000", 409],
      ["23505", 409],
      ["42501", 403],
      ["22023", 400],
      ["22007", 400],
      ["22008", 400],
      ["08006", 503],
    ] as const) {
      dbError = code;
      assert.equal((await post()).status, status);
    }
  });
}
