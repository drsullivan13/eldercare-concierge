// Server-side only. The agency's event type and access token come from Harbor's configuration.
export type CalendlyConfig = {
  token: string;
  eventTypeUri: string;
  organizationUri?: string;
  location?: { kind: "outbound_call" | "inbound_call"; location?: string };
};
export type CalendlyReceipt = {
  eventUri: string;
  inviteeUri: string;
  startTime: string;
  endTime?: string;
};
type ErrorKind = "invalid" | "unavailable" | "rejected" | "unknown";
export class CalendlyBookingError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const api = "https://api.calendly.com";
const eventTypePattern =
  /^https:\/\/api\.calendly\.com\/event_types\/[a-zA-Z0-9-]+$/;
const eventPattern =
  /^https:\/\/api\.calendly\.com\/scheduled_events\/[a-zA-Z0-9-]+$/;

function utc(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return;
  const time = Date.parse(value);
  if (Number.isFinite(time)) return new Date(time).toISOString();
}

async function request(
  config: CalendlyConfig,
  url: URL | string,
  body?: object,
) {
  if (!config.token || !eventTypePattern.test(config.eventTypeUri)) {
    throw new CalendlyBookingError(
      "invalid",
      "The agency scheduler is not configured.",
    );
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new CalendlyBookingError(
      body ? "unknown" : "rejected",
      "The agency scheduler could not be reached.",
    );
  }
  if (body && (response.status === 409 || response.status === 404)) {
    throw new CalendlyBookingError(
      "unavailable",
      "The event or time is no longer available.",
    );
  }
  if (body && (response.status === 408 || response.status >= 500)) {
    throw new CalendlyBookingError(
      "unknown",
      "The scheduler did not confirm whether it created the appointment.",
    );
  }
  if (!response.ok)
    throw new CalendlyBookingError(
      "rejected",
      "The agency scheduler rejected the request.",
    );
  if (body && response.status !== 201)
    throw new CalendlyBookingError(
      "unknown",
      "The scheduler returned an unexpected booking status.",
    );
  try {
    return await response.json();
  } catch {
    throw new CalendlyBookingError(
      body ? "unknown" : "rejected",
      "The agency scheduler returned an unreadable response.",
    );
  }
}

export async function listCalendlySlots(
  config: CalendlyConfig,
  window: { startTime: string; endTime: string },
): Promise<string[]> {
  const start = utc(window.startTime);
  const end = utc(window.endTime);
  if (
    !start ||
    !end ||
    end <= start ||
    Date.parse(end) - Date.parse(start) > 31 * 86400000
  ) {
    throw new CalendlyBookingError(
      "invalid",
      "Choose a booking window of up to 31 days.",
    );
  }
  const url = new URL("/event_type_available_times", api);
  url.search = new URLSearchParams({
    event_type: config.eventTypeUri,
    start_time: start,
    end_time: end,
  }).toString();
  const [result, type] = await Promise.all([
    request(config, url),
    request(config, config.eventTypeUri),
  ]);
  const eventType = type?.resource;
  const duration = eventType?.duration;
  if (
    eventType?.uri !== config.eventTypeUri ||
    eventType.active !== true ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 720 ||
    (eventType.duration_options != null &&
      (!Array.isArray(eventType.duration_options) ||
        !eventType.duration_options.every(
          (option: unknown) => option === duration,
        )))
  ) {
    throw new CalendlyBookingError(
      "rejected",
      "This event type must have an active, fixed consultation duration.",
    );
  }
  const lastStart = Date.parse(end) - 60_000 * duration;
  if (!Array.isArray(result?.collection))
    throw new CalendlyBookingError(
      "rejected",
      "The agency did not return availability.",
    );
  const slots = new Set<string>();
  for (const row of result.collection) {
    const time = typeof row?.start_time === "string" && utc(row.start_time);
    if (
      row?.status === "available" &&
      Number.isInteger(row.invitees_remaining) &&
      row.invitees_remaining > 0 &&
      time &&
      time >= start &&
      Date.parse(time) <= lastStart &&
      Date.parse(time) > Date.now()
    ) {
      slots.add(time);
    }
  }
  return [...slots].sort();
}

export async function bookCalendlySlot(
  config: CalendlyConfig,
  input: {
    startTime: string;
    name: string;
    email: string;
    timezone: string;
    phone?: string;
    requestId?: string;
  },
): Promise<CalendlyReceipt> {
  const startTime = utc(input.startTime);
  if (!startTime || Date.parse(startTime) <= Date.now())
    throw new CalendlyBookingError(
      "unavailable",
      "The requested time has passed.",
    );
  if (!input.name.trim() || !/^\S+@\S+\.\S+$/.test(input.email))
    throw new CalendlyBookingError(
      "invalid",
      "A name and email are required for the invitation.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw new CalendlyBookingError(
      "invalid",
      "A valid time zone is required for the invitation.",
    );
  }
  const location =
    config.location?.kind === "outbound_call"
      ? { kind: "outbound_call", location: input.phone }
      : config.location;
  if (
    location?.kind === "outbound_call" &&
    !/^\+[1-9]\d{7,14}$/.test(location.location ?? "")
  )
    throw new CalendlyBookingError(
      "invalid",
      "A callback number with country code is required.",
    );
  const result = await request(config, api + "/invitees", {
    event_type: config.eventTypeUri,
    start_time: startTime,
    invitee: {
      name: input.name.trim(),
      email: input.email,
      timezone: input.timezone,
    },
    ...(location && { location }),
    ...(input.requestId && {
      tracking: { utm_source: "harbor", utm_content: input.requestId },
    }),
  });
  const invitee = result?.resource;
  if (!matchingInvitee(invitee, input.email)) {
    throw new CalendlyBookingError(
      "unknown",
      "The scheduler did not return a matching active booking receipt.",
    );
  }
  const receipt: CalendlyReceipt = {
    eventUri: invitee.event,
    inviteeUri: invitee.uri,
    startTime,
  };
  // A failed optional end-time lookup must never cause a second booking.
  const event = (await request(config, receipt.eventUri).catch(() => null))
    ?.resource;
  const endTime = typeof event?.end_time === "string" && utc(event.end_time);
  if (
    event?.uri === receipt.eventUri &&
    event.event_type === config.eventTypeUri &&
    utc(event.start_time) === startTime &&
    endTime &&
    endTime > startTime
  )
    receipt.endTime = endTime;
  return receipt;
}

type Invitee = {
  status?: string;
  event?: string;
  uri?: string;
  email?: string;
  tracking?: { utm_content?: string; utm_source?: string };
};

function matchingInvitee(
  invitee: Invitee | null | undefined,
  email: string,
): invitee is Invitee & { event: string; uri: string } {
  if (
    !invitee ||
    invitee.status !== "active" ||
    typeof invitee.email !== "string" ||
    invitee.email.toLowerCase() !== email.toLowerCase() ||
    typeof invitee.event !== "string" ||
    !eventPattern.test(invitee.event) ||
    typeof invitee.uri !== "string"
  )
    return false;
  const prefix = invitee.event + "/invitees/";
  return (
    invitee.uri.startsWith(prefix) &&
    /^[a-zA-Z0-9-]+$/.test(invitee.uri.slice(prefix.length))
  );
}

export async function reconcileCalendlyBooking(
  config: CalendlyConfig,
  input: { startTime: string; email: string; requestId: string },
): Promise<CalendlyReceipt | null> {
  const startTime = utc(input.startTime);
  if (
    !startTime ||
    !input.requestId ||
    !config.organizationUri ||
    !/^https:\/\/api\.calendly\.com\/organizations\/[a-zA-Z0-9-]+$/.test(
      config.organizationUri,
    )
  )
    return null;
  const url = new URL("/scheduled_events", api);
  url.search = new URLSearchParams({
    organization: config.organizationUri,
    invitee_email: input.email,
    status: "active",
    min_start_time: new Date(Date.parse(startTime) - 1000).toISOString(),
    max_start_time: new Date(Date.parse(startTime) + 1000).toISOString(),
    count: "100",
  }).toString();
  const events = (await request(config, url))?.collection;
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (
      event?.status !== "active" ||
      event.event_type !== config.eventTypeUri ||
      utc(event.start_time) !== startTime ||
      !eventPattern.test(event.uri)
    )
      continue;
    const inviteesUrl = new URL(event.uri + "/invitees");
    inviteesUrl.search = new URLSearchParams({
      email: input.email,
      status: "active",
      count: "100",
    }).toString();
    const invitees = (await request(config, inviteesUrl))?.collection;
    if (!Array.isArray(invitees)) continue;
    for (const invitee of invitees) {
      if (
        matchingInvitee(invitee, input.email) &&
        invitee.event === event.uri &&
        invitee.tracking?.utm_source === "harbor" &&
        invitee.tracking.utm_content === input.requestId
      ) {
        const endTime = utc(event.end_time);
        return {
          eventUri: event.uri,
          inviteeUri: invitee.uri,
          startTime,
          ...(endTime && endTime > startTime && { endTime }),
        };
      }
    }
  }
  return null;
}
