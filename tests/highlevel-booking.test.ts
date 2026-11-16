import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  bookHighLevelSlot,
  listHighLevelSlots,
  reconcileHighLevelBooking,
} from "../src/lib/highlevel-booking";
import { CalendlyBookingError } from "../src/lib/calendly-booking";
const c = {
  locationId: "Orange",
  calendarId: "HomeConsultation",
  token: "test-only",
};
const startTime = new Date(Date.now() + 86400000).toISOString(),
  endTime = new Date(Date.parse(startTime) + 1800000).toISOString();
const input = {
  requestId: "00000000-0000-4000-8000-000000000009",
  email: "family@example.org",
  name: "Test Family",
  timezone: "America/New_York",
  startTime,
  endTime,
};
const contact = {
  id: "contactId",
  email: input.email,
  locationId: c.locationId,
};
const event = {
  startTime,
  endTime,
  calendarId: c.calendarId,
  locationId: c.locationId,
  description: "Harbor consultation request " + input.requestId,
  contactId: contact.id,
  id: "appointmentId",
  appointmentStatus: "confirmed",
};
const calendar = {
  calendar: {
    id: c.calendarId,
    locationId: c.locationId,
    isActive: true,
    slotDuration: 30,
    slotDurationUnit: "mins",
  },
};
function scheduler(
  t: TestContext,
  handler: (
    path: string,
    method: string,
    body: Record<string, unknown>,
    query: URLSearchParams,
  ) => unknown,
) {
  return t.mock.method(
    globalThis,
    "fetch",
    async (endpoint: string | URL, init: RequestInit) => {
      const u = new URL(endpoint);
      assert.equal(u.origin, "https://services.leadconnectorhq.com");
      assert.equal(new Headers(init.headers).get("Version"), "v3");
      const data = handler(
        u.pathname,
        init.method ?? "GET",
        JSON.parse(String(init.body ?? "{}")),
        u.searchParams,
      );
      return data instanceof Response ? data : Response.json(data);
    },
  );
}
test("uses only the selected agency calendar's real slots which fit the entire family window", async (t) => {
  scheduler(t, (p, _method, _body, q) => {
    if (p === "/calendars/HomeConsultation") return calendar;
    assert.equal(p, "/calendars/HomeConsultation/free-slots");
    assert.equal(q.get("endDate"), String(Date.parse(endTime)));
    return {
      [startTime.slice(0, 10)]: {
        slots: [
          startTime,
          new Date(Date.parse(startTime) + 60000).toISOString(),
          endTime,
          startTime,
        ],
      },
    };
  });
  assert.deepEqual(await listHighLevelSlots(c, input), [startTime]);
});
test("creates a contact only when missing; books without overriding provider approval and slot rules", async (t) => {
  const calls: string[] = [];
  scheduler(t, (p, m, b) => {
    calls.push(m + " " + p);
    if (p === "/calendars/HomeConsultation") return calendar;
    if (p === "/contacts/lookup") return { contacts: [] };
    if (p === "/contacts/") {
      assert.equal(b.email, input.email);
      return { contact };
    }
    assert.equal(b.appointmentStatus, undefined);
    assert.equal(b.ignoreFreeSlotValidation, false);
    assert.equal(b.ignoreDateRange, false);
    assert.equal(b.contactId, contact.id);
    assert.equal(b.toNotify, true);
    assert.equal(b.endTime, endTime);
    assert.equal(b.description, event.description);
    return event;
  });
  const receipt = await bookHighLevelSlot(c, input);
  assert.equal(receipt.startTime, startTime);
  assert.equal(receipt.endTime, endTime);
  assert.ok(receipt.eventUri.endsWith("/appointments/appointmentId"));
  assert.equal(
    calls.filter((c) => c === "POST /calendars/events/appointments").length,
    1,
  );
});
test("new, unknown, and mismatched provider receipts do not mark a meeting confirmed or resubmit", async (t) => {
  for (const response of [
    { ...event, appointmentStatus: "new" },
    { ...event, calendarId: "another" },
    new Response(null, { status: 502 }),
  ]) {
    let writes = 0;
    const mock = scheduler(t, (p, m) => {
      if (p === "/calendars/HomeConsultation") return calendar;
      if (p === "/contacts/lookup") return { contacts: [contact] };
      assert.equal(m, "POST");
      writes++;
      return response;
    });
    await assert.rejects(
      bookHighLevelSlot(c, input),
      (e) => e instanceof CalendlyBookingError && e.kind === "unknown",
    );
    assert.equal(writes, 1);
    mock.mock.restore();
  }
});
test("a cross-office calendar or ambiguous contact never produces a write", async (t) => {
  for (const invalid of ["calendar", "contact"]) {
    let writes = 0;
    const mock = scheduler(t, (p, m) => {
      if (m === "POST") writes++;
      if (p === "/calendars/HomeConsultation")
        return invalid === "calendar"
          ? { calendar: { ...calendar.calendar, locationId: "someoneElse" } }
          : calendar;
      return { contacts: [contact, contact] };
    });
    await assert.rejects(bookHighLevelSlot(c, input));
    assert.equal(writes, 0);
    mock.mock.restore();
  }
});
test("read-only reconciliation requires the request marker, precise time, agency contact, and confirmed status", async (t) => {
  const state = {
    events: [
      { ...event, description: "another request" },
      { ...event, appointmentStatus: "new" },
    ],
  };
  scheduler(t, (p, m) => {
    assert.equal(m, "GET");
    if (p === "/contacts/lookup") return { contacts: [contact] };
    assert.equal(p, "/calendars/events");
    return state;
  });
  assert.equal(await reconcileHighLevelBooking(c, input), null);
  state.events.push(event);
  assert.ok(
    (await reconcileHighLevelBooking(c, input))?.eventUri.endsWith(
      "/appointments/appointmentId",
    ),
  );
});
