// Official HighLevel v3 Sub-Account API. Keep the partner token on the server.
import {
  CalendlyBookingError as BookingError,
  type CalendlyReceipt,
} from "./calendly-booking";

export type HighLevelConfig = {
  token: string;
  locationId: string;
  calendarId: string;
  inviteDelivery?: "agency" | "harbor";
};
type BookInput = {
  startTime: string;
  endTime?: string;
  email: string;
  name: string;
  timezone: string;
  phone?: string;
  requestId: string;
};
const origin = "https://services.leadconnectorhq.com";
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const time = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v)
    ? Date.parse(v)
    : NaN;
const marker = (id: string) => `Harbor consultation request ${id}`;
function invalid(message: string): never {
  throw new BookingError("invalid", message);
}
function unknownReceipt(): never {
  throw new BookingError(
    "unknown",
    "Harbor is waiting for the agency’s appointment receipt.",
  );
}

async function api(
  c: HighLevelConfig,
  path: string,
  query?: Record<string, string>,
  body?: object,
) {
  if (!c.token || !validId(c.locationId) || !validId(c.calendarId))
    invalid("The agency calendar is not configured.");
  const url = new URL(path, origin);
  if (query) url.search = new URLSearchParams(query).toString();
  const booking =
    body !== undefined && path === "/calendars/events/appointments";
  let response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${c.token}`,
        Version: "v3",
        Accept: "application/json",
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    if (booking) unknownReceipt();
    throw new BookingError(
      "rejected",
      "The agency calendar could not be reached.",
    );
  }
  if (!response.ok) {
    if (booking && (response.status >= 500 || response.status === 408))
      unknownReceipt();
    if (booking && response.status === 409)
      throw new BookingError(
        "unavailable",
        "The agency can no longer book this time.",
      );
    throw new BookingError(
      "rejected",
      "The agency did not accept this request.",
    );
  }
  try {
    return await response.json();
  } catch {
    if (booking) unknownReceipt();
    throw new BookingError(
      "rejected",
      "The agency returned an unreadable response.",
    );
  }
}

async function durationMinutes(c: HighLevelConfig) {
  const { calendar } = await api(c, `/calendars/${c.calendarId}`);
  if (
    calendar?.id !== c.calendarId ||
    calendar.locationId !== c.locationId ||
    calendar.isActive !== true
  )
    invalid("The agency calendar does not match this office.");
  const options = calendar.durationOptions;
  const selected =
    Array.isArray(options) && options.length
      ? options.filter((o: { isDefault?: boolean }) => o?.isDefault === true)
      : [];
  if (Array.isArray(options) && options.length && selected.length !== 1)
    invalid("The agency has no unique default consultation length.");
  const n = selected.length ? selected[0].duration : calendar.slotDuration;
  const units = selected.length
    ? selected[0].durationUnit
    : calendar.slotDurationUnit;
  if (!Number.isInteger(n) || n < 1 || !["mins", "hours"].includes(units))
    invalid("The agency calendar did not provide a consultation length.");
  return n * (units === "hours" ? 60 : 1);
}
export async function listHighLevelSlots(
  c: HighLevelConfig,
  window: { startTime: string; endTime: string },
): Promise<string[]> {
  const start = time(window.startTime),
    end = time(window.endTime);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 31 * 86400000
  )
    invalid("Choose a valid booking window.");
  const [duration, days] = await Promise.all([
    durationMinutes(c),
    api(c, `/calendars/${c.calendarId}/free-slots`, {
      startDate: String(start),
      endDate: String(end),
      timezone: "UTC",
    }),
  ]);
  if (!days || typeof days !== "object" || Array.isArray(days))
    throw new BookingError(
      "rejected",
      "The agency did not return available slots.",
    );
  const slots = new Set<string>();
  for (const [date, day] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (
      !day ||
      typeof day !== "object" ||
      !("slots" in day) ||
      !Array.isArray(day.slots)
    )
      throw new BookingError(
        "rejected",
        "The agency returned invalid availability.",
      );
    for (const slot of day.slots) {
      const t = time(slot);
      if (t > Date.now() && t >= start && t + duration * 60000 <= end)
        slots.add(new Date(t).toISOString());
    }
  }
  return [...slots].sort();
}
type Contact = {
  id: string;
  locationId: string;
  email: string;
  phone?: string;
};
const matchesContact = (
  contact: Contact | undefined,
  c: HighLevelConfig,
  email: string,
) =>
  validId(contact?.id) &&
  contact?.locationId === c.locationId &&
  typeof contact.email === "string" &&
  contact.email.toLowerCase() === email.toLowerCase();
async function lookup(
  c: HighLevelConfig,
  email: string,
): Promise<Contact | null> {
  const result = await api(c, "/contacts/lookup", {
    locationId: c.locationId,
    email,
    limit: "2",
  });
  if (
    !Array.isArray(result?.contacts) ||
    result.contacts.length > 1 ||
    result.nextCursor
  )
    invalid("The agency could not uniquely match the invitee.");
  if (!result.contacts.length) return null;
  const contact = result.contacts[0];
  if (!matchesContact(contact, c, email))
    invalid("The invitee does not match the primary agency contact.");
  return contact;
}
function receipt(
  event: Record<string, unknown> | null,
  c: HighLevelConfig,
  start: string,
  contactId: string,
  latest?: string,
): CalendlyReceipt | null {
  const end = time(event?.endTime);
  if (
    !event ||
    !validId(event.id) ||
    event.deleted === true ||
    event.appointmentStatus !== "confirmed" ||
    event.locationId !== c.locationId ||
    event.calendarId !== c.calendarId ||
    event.contactId !== contactId ||
    time(event.startTime) !== time(start) ||
    !Number.isFinite(end) ||
    end <= time(start) ||
    (latest && end > time(latest))
  )
    return null;
  return {
    eventUri: `${origin}/calendars/events/appointments/${event.id}`,
    inviteeUri: `${origin}/contacts/${contactId}`,
    startTime: new Date(time(start)).toISOString(),
    endTime: new Date(end).toISOString(),
  };
}

export async function bookHighLevelSlot(
  c: HighLevelConfig,
  input: BookInput,
): Promise<CalendlyReceipt> {
  const start = time(input.startTime),
    latest = time(input.endTime);
  if (
    !Number.isFinite(start) ||
    start <= Date.now() ||
    !Number.isFinite(latest) ||
    !validId(input.requestId) ||
    !input.name.trim() ||
    !/^\S+@\S+\.\S+$/.test(input.email)
  )
    invalid("A verified contact, request and time window are required.");
  const end = start + 60000 * (await durationMinutes(c));
  if (end > latest)
    throw new BookingError(
      "unavailable",
      "The consultation no longer fits the requested window.",
    );
  const existing = await lookup(c, input.email);
  if (existing && input.phone && existing.phone !== input.phone)
    invalid("The agency's contact has a different callback number.");
  // Create only when there is no match. Upsert could overwrite a different family member via phone-based deduplication.
  const contact =
    existing ??
    (
      await api(c, "/contacts/", undefined, {
        locationId: c.locationId,
        name: input.name,
        email: input.email,
        timezone: input.timezone,
        ...(input.phone && { phone: input.phone }),
      })
    ).contact;
  if (!matchesContact(contact, c, input.email))
    invalid("The agency did not return a matching contact.");
  const event = await api(c, "/calendars/events/appointments", undefined, {
    calendarId: c.calendarId,
    locationId: c.locationId,
    contactId: contact.id,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    description: marker(input.requestId),
    ignoreFreeSlotValidation: false,
    ignoreDateRange: false,
    toNotify: true,
  });
  // Omit appointmentStatus in the write so the agency's own confirmation setting governs it.
  return (
    receipt(event, c, input.startTime, contact.id, input.endTime) ??
    unknownReceipt()
  );
}

export async function reconcileHighLevelBooking(
  c: HighLevelConfig,
  input: {
    startTime: string;
    email: string;
    requestId: string;
    endTime?: string;
  },
): Promise<CalendlyReceipt | null> {
  const start = time(input.startTime);
  if (!Number.isFinite(start) || !validId(input.requestId)) return null;
  const contact = await lookup(c, input.email);
  if (!contact) return null;
  const data = await api(c, "/calendars/events", {
    locationId: c.locationId,
    calendarId: c.calendarId,
    startTime: String(start - 1000),
    endTime: String(start + 1000),
  });
  if (!Array.isArray(data.events)) return null;
  for (const event of data.events) {
    if (event?.description !== marker(input.requestId)) continue;
    const match = receipt(event, c, input.startTime, contact.id, input.endTime);
    if (match) return match;
  }
  return null;
}
