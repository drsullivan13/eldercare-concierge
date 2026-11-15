import type { Provider } from "./providers";

type SuitableInterview = {
  status: "completed";
  outcome: "suitable";
  occurredAt: string;
};

export type HomeCareInterview =
  | { status: "not-started" }
  | { status: "scheduled"; scheduledAt: string }
  | {
      status: "completed";
      outcome: "suitable" | "not-suitable";
      occurredAt: string;
    }
  | { status: "declined" | "no-response" | "reschedule" };

type Introduction = {
  status: "proposed" | "confirmed" | "cancelled";
  startsAt: string;
};

export type HomeCareOutreachRecord = {
  providerName: string;
  notes: string;
  updatedAt: string;
} & (
  | { stage: "interview"; interview: HomeCareInterview }
  | {
      stage: "introduction";
      interview: SuitableInterview;
      introduction: Introduction;
    }
);

export const HOME_CARE_INTERVIEW_LABELS = {
  "not-started": "Not yet arranged",
  scheduled: "Interview scheduled",
  suitable: "Completed, suitable for an introduction",
  "not-suitable": "Completed, not a fit",
  declined: "Agency or family declined",
  "no-response": "No response",
  reschedule: "Needs rescheduling",
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function text(value: unknown, max: number, min = 0): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    value.trim().length >= min &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}

function instant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseInterview(value: unknown): HomeCareInterview | null {
  if (!object(value)) return null;
  if (
    (value.status === "not-started" ||
      value.status === "declined" ||
      value.status === "no-response" ||
      value.status === "reschedule") &&
    keys(value, ["status"])
  )
    return { status: value.status };
  if (
    value.status === "scheduled" &&
    keys(value, ["status", "scheduledAt"]) &&
    instant(value.scheduledAt)
  )
    return { status: value.status, scheduledAt: value.scheduledAt };
  if (
    value.status === "completed" &&
    keys(value, ["status", "outcome", "occurredAt"]) &&
    (value.outcome === "suitable" || value.outcome === "not-suitable") &&
    instant(value.occurredAt)
  )
    return {
      status: value.status,
      outcome: value.outcome,
      occurredAt: value.occurredAt,
    };
  return null;
}

export function parseHomeCareOutreach(
  value: unknown,
): Record<string, HomeCareOutreachRecord> | null {
  if (!object(value) || Object.keys(value).length > 100) return null;
  const entries: [string, HomeCareOutreachRecord][] = [];
  for (const [providerId, raw] of Object.entries(value)) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(providerId) ||
      ["__proto__", "constructor", "prototype"].includes(providerId) ||
      !object(raw) ||
      !keys(raw, [
        "providerName",
        "notes",
        "updatedAt",
        "stage",
        "interview",
        "introduction",
      ]) ||
      !text(raw.providerName, 240, 1) ||
      !text(raw.notes, 2000) ||
      !instant(raw.updatedAt)
    )
      return null;
    const interview = parseInterview(raw.interview);
    if (
      !interview ||
      (interview.status === "completed" &&
        (interview.occurredAt > raw.updatedAt ||
          Date.parse(interview.occurredAt) > Date.now()))
    )
      return null;
    const base = {
      providerName: raw.providerName,
      notes: raw.notes,
      updatedAt: raw.updatedAt,
    };
    if (raw.stage === "interview" && !("introduction" in raw)) {
      entries.push([providerId, { ...base, stage: "interview", interview }]);
    } else if (
      raw.stage === "introduction" &&
      interview.status === "completed" &&
      interview.outcome === "suitable" &&
      object(raw.introduction) &&
      keys(raw.introduction, ["status", "startsAt"]) &&
      ["proposed", "confirmed", "cancelled"].includes(
        String(raw.introduction.status),
      ) &&
      instant(raw.introduction.startsAt) &&
      raw.introduction.startsAt > interview.occurredAt
    ) {
      const status = raw.introduction.status;
      if (
        status !== "proposed" &&
        status !== "confirmed" &&
        status !== "cancelled"
      )
        return null;
      entries.push([
        providerId,
        {
          ...base,
          stage: "introduction",
          interview: { ...interview, outcome: "suitable" },
          introduction: { status, startsAt: raw.introduction.startsAt },
        },
      ]);
    } else return null;
  }
  return Object.fromEntries(entries);
}

export function recordHomeCareInterview(
  providerName: string,
  previous: HomeCareOutreachRecord | undefined,
  interview: HomeCareInterview,
  notes: string,
  updatedAt = new Date().toISOString(),
): HomeCareOutreachRecord {
  const base = { providerName, notes, updatedAt };
  if (
    previous?.stage === "introduction" &&
    interview.status === "completed" &&
    interview.outcome === "suitable" &&
    previous.interview.occurredAt === interview.occurredAt
  )
    return { ...previous, ...base };
  return { ...base, stage: "interview", interview };
}

export function recordHomeCareIntroduction(
  previous: HomeCareOutreachRecord,
  introduction: Introduction,
  updatedAt = new Date().toISOString(),
): HomeCareOutreachRecord {
  if (
    previous.interview.status !== "completed" ||
    previous.interview.outcome !== "suitable"
  )
    throw new Error(
      "Complete a suitable interview before arranging an introduction.",
    );
  if (introduction.startsAt <= previous.interview.occurredAt)
    throw new Error("The introduction must be after the interview.");
  return {
    ...previous,
    updatedAt,
    stage: "introduction",
    interview: { ...previous.interview, outcome: "suitable" },
    introduction,
  };
}

export function homeCareNextAction(record: HomeCareOutreachRecord) {
  if (record.stage === "introduction") {
    const { status, startsAt } = record.introduction;
    return {
      label:
        status === "confirmed"
          ? "Attend the in-home introduction, confirmed by your family"
          : status === "cancelled"
            ? "Arrange a new introduction if your family still wants one"
            : "Ask the agency to confirm the proposed in-home introduction",
      at: startsAt,
    };
  }
  const interview = record.interview;
  switch (interview.status) {
    case "not-started":
      return { label: "Contact the agency to arrange an interview" };
    case "scheduled":
      return {
        label: "Attend the interview and record its outcome",
        at: interview.scheduledAt,
      };
    case "completed":
      return {
        label:
          interview.outcome === "suitable"
            ? "Invite the agency for an in-home introduction"
            : "Consider another agency, or correct the interview outcome",
        at: interview.occurredAt,
      };
    case "declined":
      return { label: "Consider another agency, or reopen the interview" };
    case "no-response":
      return { label: "Follow up with the agency about an interview" };
    case "reschedule":
      return { label: "Agree on a new interview time with the agency" };
  }
}

export function homeCareContactLinks(
  provider: Pick<Provider, "phone" | "website" | "sources">,
) {
  const links: { label: string; href: string }[] = [];
  if (provider.phone && /^[+\d().\s-]+$/.test(provider.phone)) {
    const phone = provider.phone.replace(/[^+\d]/g, "");
    if (/\d{7,}/.test(phone))
      links.push({ label: `Call ${provider.phone}`, href: `tel:${phone}` });
  }
  for (const source of provider.sources) {
    if (source.kind !== "provider") continue;
    if (
      /^mailto:[A-Za-z0-9.!#$%&'*+/=_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
        source.url,
      )
    )
      links.push({ label: "Compose your own email", href: source.url });
    else if (
      /\b(contact|inquiry|inquire)\b/i.test(source.title) &&
      safeWebsite(source.url)
    )
      links.push({ label: source.title, href: source.url });
  }
  if (provider.website && safeWebsite(provider.website))
    links.push({ label: "Open agency website", href: provider.website });
  return links.filter(
    (link, index) =>
      links.findIndex((other) => other.href === link.href) === index,
  );
}

function safeWebsite(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function homeCareDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
