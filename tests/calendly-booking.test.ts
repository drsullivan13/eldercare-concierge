import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  bookCalendlySlot,
  CalendlyBookingError,
  listCalendlySlots,
  reconcileCalendlyBooking,
} from "../src/lib/calendly-booking";

const config = {
  eventTypeUri: "https://api.calendly.com/event_types/agencyA",
  token: "local-only",
  organizationUri: "https://api.calendly.com/organizations/test",
};
const eventUri = "https://api.calendly.com/scheduled_events/test-event";
const startTime = new Date(Date.now() + 86400000).toISOString();
const endTime = new Date(Date.parse(startTime) + 1800000).toISOString();
const input = {
  startTime,
  name: "Test User",
  email: "test@example.org",
  timezone: "America/New_York",
  requestId: "dd58a6cb-77f5-48f5-bf4b-4ab4fca3df00",
};
const invitee = {
  uri: eventUri + "/invitees/test",
  event: eventUri,
  status: "active",
  email: input.email,
  tracking: { utm_source: "harbor", utm_content: input.requestId },
};
const event = {
  uri: eventUri,
  status: "active",
  start_time: startTime,
  end_time: endTime,
  event_type: config.eventTypeUri,
};
function mockApi(
  t: TestContext,
  ...responses: ((url: URL, init: RequestInit) => Response)[]
) {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init: RequestInit) => {
      const next = responses.shift();
      assert.ok(next, "Unexpected extra request");
      return next(new URL(url), init);
    },
  );
  t.after(() =>
    assert.equal(responses.length, 0, "An expected request was not made"),
  );
  return mock;
}
test("only returns available slots inside the requested window for the configured agency", async (t) => {
  mockApi(
    t,
    (url, init) => {
      assert.equal(url.searchParams.get("event_type"), config.eventTypeUri);
      assert.equal(init.method, "GET");
      const row = {
        status: "available",
        invitees_remaining: 1,
        start_time: startTime,
      };
      return Response.json({
        collection: [
          { ...row, start_time: endTime },
          {
            ...row,
            start_time: new Date(Date.parse(startTime) + 60000).toISOString(),
          },
          row,
          {
            ...row,
            invitees_remaining: 0,
            start_time: new Date(Date.parse(startTime) + 1000).toISOString(),
          },
          row,
        ],
      });
    },
    (url) => {
      assert.equal(url.href, config.eventTypeUri);
      return Response.json({
        resource: {
          uri: config.eventTypeUri,
          active: true,
          duration: 30,
          duration_options: [],
        },
      });
    },
  );
  assert.deepEqual(await listCalendlySlots(config, { startTime, endTime }), [
    startTime,
  ]);
});
test("creates the phone consultation with authorized contact details and parses the receipt", async (t) => {
  mockApi(
    t,
    (url, init) => {
      assert.equal(url.href, "https://api.calendly.com/invitees");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(String(init.body)), {
        event_type: config.eventTypeUri,
        start_time: startTime,
        invitee: {
          name: input.name,
          email: input.email,
          timezone: input.timezone,
        },
        location: { kind: "outbound_call", location: "+12025550123" },
        tracking: invitee.tracking,
      });
      return Response.json({ resource: invitee }, { status: 201 });
    },
    (url) => {
      assert.equal(url.href, eventUri);
      return Response.json({ resource: event });
    },
  );
  assert.deepEqual(
    await bookCalendlySlot(
      { ...config, location: { kind: "outbound_call" } },
      { ...input, phone: "+12025550123" },
    ),
    { eventUri, inviteeUri: invitee.uri, startTime, endTime },
  );
});
test("a missing scope to read duration preserves the successful write", async (t) => {
  mockApi(
    t,
    () => Response.json({ resource: invitee }, { status: 201 }),
    () => new Response(null, { status: 403 }),
  );
  assert.deepEqual(await bookCalendlySlot(config, input), {
    eventUri,
    inviteeUri: invitee.uri,
    startTime,
  });
});
test("ambiguous and definitely stale writes never trigger a second POST", async (t) => {
  for (const [response, kind] of [
    [new Response(null, { status: 404 }), "unavailable"],
    [new Response(null, { status: 503 }), "unknown"],
    [
      Response.json(
        { resource: { ...invitee, uri: "https://example.org/invitees/test" } },
        { status: 201 },
      ),
      "unknown",
    ],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      bookCalendlySlot(config, input),
      (e) => e instanceof CalendlyBookingError && e.kind === kind,
    );
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});
test("reconciliation only accepts the exact request, agency event and invitee", async (t) => {
  mockApi(
    t,
    (url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(url.searchParams.get("invitee_email"), input.email);
      return Response.json({
        collection: [{ ...event, event_type: "another agency" }, event],
      });
    },
    (url, init) => {
      assert.equal(url.pathname, "/scheduled_events/test-event/invitees");
      assert.equal(init.method, "GET");
      return Response.json({
        collection: [
          {
            ...invitee,
            tracking: { ...invitee.tracking, utm_content: "another request" },
          },
        ],
      });
    },
  );
  assert.equal(await reconcileCalendlyBooking(config, input), null);
});
test("reconciliation recovers the provider receipt without creating another invite", async (t) => {
  mockApi(
    t,
    () => Response.json({ collection: [event] }),
    () => Response.json({ collection: [invitee] }),
  );
  assert.deepEqual(await reconcileCalendlyBooking(config, input), {
    eventUri,
    inviteeUri: invitee.uri,
    startTime,
    endTime,
  });
});
