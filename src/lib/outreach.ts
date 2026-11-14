export type OutreachProvider = {
  providerId: string;
  providerName: string;
  phone: string;
};

export type OutreachBrief = OutreachProvider & {
  requestId: string;
  readKey: string;
  topics: string[];
  question: string;
  previous?: string;
};

export type OutreachRecord = {
  brief: OutreachBrief;
  createdAt: string;
  updatedAt: string;
  state: "requested" | "opened" | "connected" | "completed" | "failed";
  parentId?: string;
  findings: string[];
  nextSteps: string[];
};

type OutreachResult = Pick<
  OutreachRecord,
  "updatedAt" | "findings" | "nextSteps"
> & { state: Exclude<OutreachRecord["state"], "requested"> };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_KEY = /^[0-9a-f]{64}$/i;
const RANK = { requested: 0, opened: 1, connected: 2, completed: 3, failed: 3 };

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
    !value.includes("\0")
  );
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function details(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => text(item, 1200, 1))
  );
}

export function parseOutreachResult(value: unknown): OutreachResult | null {
  if (
    !object(value) ||
    !keys(value, ["state", "updatedAt", "findings", "nextSteps"]) ||
    typeof value.state !== "string" ||
    !["opened", "connected", "completed", "failed"].includes(value.state) ||
    !timestamp(value.updatedAt) ||
    !details(value.findings, 16) ||
    !details(value.nextSteps, 12)
  )
    return null;
  return {
    state: value.state as OutreachResult["state"],
    updatedAt: value.updatedAt,
    findings: [...new Set(value.findings)],
    nextSteps: [...new Set(value.nextSteps)],
  };
}

export function parseOutreachRecord(value: unknown): OutreachRecord | null {
  if (
    !object(value) ||
    !keys(value, [
      "brief",
      "createdAt",
      "updatedAt",
      "state",
      "parentId",
      "findings",
      "nextSteps",
    ])
  )
    return null;
  const brief = value.brief;
  if (
    !object(brief) ||
    !keys(brief, [
      "providerId",
      "providerName",
      "phone",
      "requestId",
      "readKey",
      "topics",
      "question",
      "previous",
    ]) ||
    !text(brief.providerId, 100, 1) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(brief.providerId) ||
    ["__proto__", "constructor", "prototype"].includes(brief.providerId) ||
    !text(brief.providerName, 200, 1) ||
    !text(brief.phone, 64) ||
    typeof brief.requestId !== "string" ||
    !UUID.test(brief.requestId) ||
    typeof brief.readKey !== "string" ||
    !READ_KEY.test(brief.readKey) ||
    !Array.isArray(brief.topics) ||
    brief.topics.length > 6 ||
    !brief.topics.every((topic) => text(topic, 80, 1)) ||
    !text(brief.question, 1000) ||
    !(brief.previous === undefined || text(brief.previous, 1200)) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    typeof value.state !== "string" ||
    !Object.hasOwn(RANK, value.state) ||
    !(
      value.parentId === undefined ||
      (typeof value.parentId === "string" &&
        UUID.test(value.parentId) &&
        value.parentId !== brief.requestId)
    ) ||
    !details(value.findings, 16) ||
    !details(value.nextSteps, 12)
  )
    return null;
  return {
    brief: {
      providerId: brief.providerId,
      providerName: brief.providerName,
      phone: brief.phone,
      requestId: brief.requestId,
      readKey: brief.readKey,
      topics: [...new Set(brief.topics)] as string[],
      question: brief.question,
      ...(brief.previous === undefined ? {} : { previous: brief.previous }),
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    state: value.state as OutreachRecord["state"],
    ...(value.parentId === undefined ? {} : { parentId: value.parentId }),
    findings: [...new Set(value.findings)],
    nextSteps: [...new Set(value.nextSteps)],
  };
}

export function outreachPending(record: OutreachRecord) {
  return RANK[record.state] < 3;
}

export function mergeOutreach(
  current: OutreachRecord[],
  incoming: OutreachRecord[],
): OutreachRecord[] {
  const records = new Map(
    current.map((record) => [record.brief.requestId, record]),
  );
  for (const record of incoming) {
    const previous = records.get(record.brief.requestId);
    if (!previous) {
      records.set(record.brief.requestId, record);
      continue;
    }
    if (previous.state === "completed") continue;
    const newer = Date.parse(record.updatedAt) > Date.parse(previous.updatedAt);
    // Only requested uses the browser's clock. Advanced server states can be earlier.
    const advance =
      outreachPending(previous) && RANK[record.state] > RANK[previous.state];
    const recover =
      previous.state === "failed" &&
      newer &&
      ["opened", "connected", "completed"].includes(record.state);
    // A request's credentials and brief are immutable after the click that saved it.
    if (
      (advance || recover || (record.state === previous.state && newer)) &&
      JSON.stringify(previous.brief) === JSON.stringify(record.brief)
    )
      records.set(record.brief.requestId, {
        ...previous,
        state: record.state,
        updatedAt: record.updatedAt,
        findings: record.findings,
        nextSteps: record.nextSteps,
      });
  }
  return [...records.values()].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.brief.requestId.localeCompare(b.brief.requestId),
  );
}

export function createOutreachRecord(
  provider: OutreachProvider,
  topics: string[],
  question: string,
  parent?: OutreachRecord,
): OutreachRecord {
  const now = new Date().toISOString();
  const previous = parent
    ? [
        ...parent.findings.map(
          (finding) => `Prior rehearsal finding: ${finding}`,
        ),
        ...parent.nextSteps.map((step) => `Unanswered request: ${step}`),
        ...(parent.state === "failed" || outreachPending(parent)
          ? [
              parent.brief.question &&
                `Prior user request: ${parent.brief.question}`,
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1200)
    : "";
  const candidate = parseOutreachRecord({
    brief: {
      providerId: provider.providerId,
      providerName: provider.providerName,
      phone: provider.phone,
      requestId: crypto.randomUUID(),
      readKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      topics: [...new Set(topics.map((topic) => topic.trim()))],
      question: question.trim(),
      ...(previous ? { previous } : {}),
    },
    createdAt: now,
    updatedAt: now,
    state: "requested",
    ...(parent ? { parentId: parent.brief.requestId } : {}),
    findings: [],
    nextSteps: [],
  });
  if (!candidate)
    throw new Error("Check the provider, topics and question limits.");
  return candidate;
}

export function outreachUrl(
  brief: OutreachBrief,
  workspace: "account" | "demo" = "demo",
): string {
  const bytes = new TextEncoder().encode(JSON.stringify(brief));
  const encoded = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `https://harbor-voice-lab.vercel.app/#outreach=${encoded}${workspace === "account" ? "&workspace=account" : ""}`;
}
