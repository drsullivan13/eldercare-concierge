/** Private family-reported office responses; never published or treated as confirmation. */
const INQUIRY_FACT_KINDS = [
  "coverage_zip",
  "hourly_rate",
  "minimum_hours",
  "earliest_start",
] as const;
type InquiryFactKind = (typeof INQUIRY_FACT_KINDS)[number];
export type InquiryFact = {
  id: string;
  requestId: string;
  providerId: string;
  careZip: string;
  kind: InquiryFactKind;
  value: string | null;
  checkedOn: string;
  validUntil: string | null;
  source: "family_reported_office_response";
};
export const MAX_INQUIRY_FACTS = 200;
export function isInquiryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function isInquiryDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function parseInquiryFact(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): InquiryFact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const f = value as Record<string, unknown>;
  const keys = [
    "id",
    "requestId",
    "providerId",
    "careZip",
    "kind",
    "value",
    "checkedOn",
    "validUntil",
    "source",
  ];
  if (
    Object.keys(f).length !== keys.length ||
    Object.keys(f).some((k) => !keys.includes(k)) ||
    !isInquiryId(f.id) ||
    !isInquiryId(f.requestId) ||
    typeof f.providerId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(f.providerId) ||
    typeof f.careZip !== "string" ||
    !/^\d{5}$/.test(f.careZip) ||
    !INQUIRY_FACT_KINDS.includes(f.kind as InquiryFactKind) ||
    !isInquiryDate(f.checkedOn) ||
    f.checkedOn > today ||
    !(
      f.validUntil === null ||
      (isInquiryDate(f.validUntil) && f.validUntil >= f.checkedOn)
    ) ||
    f.source !== "family_reported_office_response"
  )
    return null;
  if (f.value !== null) {
    if (typeof f.value !== "string") return null;
    if (
      f.kind === "coverage_zip" &&
      !["serves", "does_not_serve"].includes(f.value)
    )
      return null;
    if (
      (f.kind === "hourly_rate" || f.kind === "minimum_hours") &&
      (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(f.value) ||
        Number(f.value) > (f.kind === "hourly_rate" ? 10000 : 168))
    )
      return null;
    if (f.kind === "earliest_start" && !isInquiryDate(f.value)) return null;
  }
  return {
    ...f,
    id: f.id.toLowerCase(),
    requestId: f.requestId.toLowerCase(),
  } as InquiryFact;
}
export function summarizeInquiryFacts(
  facts: InquiryFact[],
  today = new Date().toISOString().slice(0, 10),
) {
  return INQUIRY_FACT_KINDS.map((kind) => {
    const history = facts.filter((f) => f.kind === kind);
    let latest: InquiryFact | null = null;
    const numeric = kind === "hourly_rate" || kind === "minimum_hours";
    const values = new Set<string>();
    for (const fact of history) {
      if (!latest || fact.checkedOn >= latest.checkedOn) latest = fact;
      if (
        fact.value !== null &&
        fact.validUntil !== null &&
        fact.checkedOn <= today &&
        fact.validUntil >= today
      ) {
        values.add(numeric ? String(Number(fact.value)) : fact.value);
      }
    }
    let status: "unknown" | "stale" | "reported" | "conflicting" = "unknown";
    if (values.size > 1) status = "conflicting";
    else if (latest && latest.value !== null && latest.validUntil !== null) {
      status = latest.validUntil < today ? "stale" : "reported";
    }
    return { kind, status, facts: history, latest };
  });
}
