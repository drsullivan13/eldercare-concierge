// The office hears all times in its local time zone.
import { createHmac, timingSafeEqual } from "node:crypto";

const zone = "America/New_York";
const local = new Intl.DateTimeFormat("en-US", {
  timeZone: zone,
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
export function officeTime(iso: string) {
  return local.format(new Date(iso));
}

export function consultationPhone(raw: unknown) {
  if (typeof raw !== "string" || !/^[+() .\d-]+$/.test(raw)) return;
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return "+1" + digits;
}

function officeNumber(providerId: string) {
  const map = JSON.parse(process.env.HARBOR_PHONE_AGENCIES || "{}");
  return map && Object.hasOwn(map, providerId)
    ? consultationPhone(map[providerId])
    : undefined;
}
function endpoint() {
  const url = new URL(process.env.HARBOR_BOOKING_ORIGIN || "");
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("Invalid booking origin");
  return url.origin + "/api/consultation-call";
}
export function phoneConsultationConfigured(providerId: string) {
  return Boolean(
    officeNumber(providerId) &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    consultationPhone(process.env.HARBOR_BOOKING_FROM) &&
    process.env.HARBOR_BOOKING_ORIGIN &&
    process.env.RESEND_API_KEY &&
    process.env.HARBOR_INVITE_FROM,
  );
}
export function callURL(requestId: string, step: string, at?: string) {
  const url = new URL(endpoint());
  url.searchParams.set("id", requestId);
  url.searchParams.set("step", step);
  if (at) url.searchParams.set("at", at);
  return url.toString();
}
export async function startPhoneConsultation(input: {
  providerId: string;
  requestId: string;
  phone?: string;
  [key: string]: unknown;
}) {
  const to = officeNumber(input.providerId);
  if (
    !phoneConsultationConfigured(input.providerId) ||
    !to ||
    !consultationPhone(input.phone)
  )
    throw Error("Office phone booking unavailable");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const params = new URLSearchParams({
    From: consultationPhone(process.env.HARBOR_BOOKING_FROM)!,
    To: to,
    Url: callURL(input.requestId, "offer"),
    Method: "POST",
    StatusCallback: callURL(input.requestId, "status"),
    StatusCallbackEvent: "completed",
    Timeout: "30",
    TimeLimit: "240",
  });
  const response = await fetch(
    "https://api.twilio.com/2010-04-01/Accounts/" +
      encodeURIComponent(sid) +
      "/Calls.json",
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString(
            "base64",
          ),
      },
      body: params,
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
    },
  );
  if (!response.ok) throw Error("Call could not be verified");
  const result = await response.json();
  if (!/^CA[a-f0-9]{32}$/i.test(result.sid))
    throw Error("Call receipt missing");
  return { callSid: result.sid as string };
}
export function verifyCall(request: Request, body: URLSearchParams) {
  const token = process.env.TWILIO_AUTH_TOKEN,
    presented = request.headers.get("x-twilio-signature");
  if (
    !token ||
    !presented ||
    body.get("AccountSid") !== process.env.TWILIO_ACCOUNT_SID
  )
    return false;
  const query = new URL(request.url).search;
  const pairs = [...new Set(body.keys())]
    .sort()
    .flatMap((k) => [...new Set(body.getAll(k))].sort().map((v) => k + v));
  const mac = createHmac("sha1", token)
    .update(endpoint() + query + pairs.join(""))
    .digest("base64");
  return (
    mac.length === presented.length &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(presented, "ascii"))
  );
}
export function verifiedOffice(providerId: string, to: string | null) {
  const matched = officeNumber(providerId);
  return Boolean(matched && matched === consultationPhone(to));
}

export const consultationMinutes = 15;
export function fitsWindow(
  at: string,
  start: string,
  end: string,
  now = Date.now(),
) {
  const time = Date.parse(at);
  return (
    time >= Math.max(Date.parse(start), now) &&
    time + consultationMinutes * 60000 <= Date.parse(end)
  );
}
// MMDDHHMM in New Jersey. Test both offsets and round-trip, including the repeated autumn hour.
export function agencySlot(
  digits: string,
  start: string,
  end: string,
  now = Date.now(),
) {
  if (!/^\d{8}$/.test(digits)) return;
  const [month, day, hour, minute] = digits.match(/../g)!.map(Number);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matches: string[] = [];
  for (const year of new Set([
    new Date(start).getUTCFullYear(),
    new Date(end).getUTCFullYear(),
    new Date(Date.parse(start) - 86400000).getUTCFullYear(),
  ])) {
    for (const offset of [4, 5]) {
      const iso = new Date(
        Date.UTC(year, month - 1, day, hour + offset, minute),
      ).toISOString();
      if (!fitsWindow(iso, start, end, now)) continue;
      const parts = Object.fromEntries(
        fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
      );
      if (parts.month + parts.day + parts.hour + parts.minute === digits)
        matches.push(iso);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}
// Accept an explicit weekday and clock time from the office. Ambiguous times fall back to the keypad.
export function spokenOfficeSlot(
  words: string,
  start: string,
  end: string,
  now = Date.now(),
) {
  const normalized = words
    .toLowerCase()
    .replaceAll(".", "")
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
      (n) =>
        String(
          [
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "ten",
            "eleven",
            "twelve",
          ].indexOf(n) + 1,
        ),
    );
  const match = normalized.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:,? (?:at )?)(1[0-2]|[1-9])(?::([0-5]\d)| (thirty|fifteen|forty-five))?\s*(am|pm)\b/,
  );
  if (!match) return;
  const [, weekday, hour, numeric, word, period] = match;
  const clock =
    String((Number(hour) % 12) + (period === "pm" ? 12 : 0)).padStart(2, "0") +
    (numeric ??
      (word === "thirty"
        ? "30"
        : word === "fifteen"
          ? "15"
          : word === "forty-five"
            ? "45"
            : "00"));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "2-digit",
    day: "2-digit",
  });
  const candidates = new Set<string>();
  for (
    let t = Date.parse(start) - 86400000;
    t <= Date.parse(end) + 86400000;
    t += 86400000
  ) {
    const d = Object.fromEntries(
      fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]),
    );
    if (d.weekday.toLowerCase() === weekday) {
      const iso = agencySlot(d.month + d.day + clock, start, end, now);
      if (iso) candidates.add(iso);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}
export function xmlText(s: string) {
  return s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
