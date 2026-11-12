import { markets, type MarketRegistry } from "./markets";

export const MAX_EVIDENCE_RECORDS = 25;
const DEFAULT_EVIDENCE_RECORDS = 5;
export const SCOPE_SEVERITY_GUIDE_URL =
  "https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/som107c07pdf.pdf#page=42";

/** CMS State Operations Manual, Chapter 7 §7203.3.2 (Rev. 244, June 2026).
 * This explains the source code; it does not assess a home's current conditions.
 */
export function scopeSeverityLabel(
  code: string | null | undefined,
): string | null {
  if (typeof code !== "string" || !/^[A-L]$/.test(code)) return null;
  const index = code.charCodeAt(0) - "A".charCodeAt(0);
  const scope = ["Isolated", "Pattern", "Widespread"][index % 3];
  const severity = [
    "No actual harm; potential for minimal harm",
    "No actual harm; potential for more than minimal harm, not immediate jeopardy",
    "Actual harm, not immediate jeopardy",
    "Immediate jeopardy to resident health or safety",
  ][Math.floor(index / 3)];
  return `${scope} · ${severity}`;
}

export type HealthCitation = {
  id: string;
  surveyDate: string | null;
  tag: string;
  category: string;
  description: string;
  scopeSeverityCode: string | null;
  scopeSeverityLabel?: string | null;
  standard: boolean | null;
  complaint: boolean | null;
  infectionControl: boolean | null;
  correctionStatus: string | null;
  correctionDate: string | null;
  inspectionCycle: string | null;
  underIDR: boolean | null;
  underIIDR: boolean | null;
  surveyFootnote: string | null;
  processingDate: string | null;
};

export type PenaltyEvent = {
  id: string;
  date: string | null;
  type: "Fine" | "Payment Denial";
  fineId: string | null;
  fineAmount: number | null;
  paymentDenialStartDate: string | null;
  paymentDenialLengthDays: number | null;
  processingDate: string | null;
};

type Collection<T> = { total: number; records: T[] };
type PenaltyCollection = Collection<PenaltyEvent> & {
  fineCount: number;
  paymentDenialCount: number;
};
type FacilityHistory = {
  healthCitations: Collection<HealthCitation> | null;
  penalties: PenaltyCollection | null;
};
type EvidenceSource = {
  datasetId: string;
  title: string;
  url: string;
  downloadUrl: string;
  modified: string | null;
  released: string | null;
};
export type InspectionHistorySnapshot = {
  retrieved: string;
  dictionaryUrl: string;
  sources: EvidenceSource[];
  facilities: Record<string, FacilityHistory>;
};
type BoundedCollection<T> = {
  available: boolean;
  total: number | null;
  returned: number;
  hasMore: boolean;
  records: T[];
};

export type InspectionEvidence = {
  ccn: string;
  providerName: string;
  providerId: string;
  careCompareUrl: string;
  retrieved: string;
  limit: number;
  maximumLimit: number;
  dictionaryUrl: string;
  scopeSeverityGuideUrl: string;
  sources: EvidenceSource[];
  healthCitations: BoundedCollection<HealthCitation>;
  penalties: BoundedCollection<PenaltyEvent> & {
    fineCount: number | null;
    paymentDenialCount: number | null;
  };
};

export class EvidenceInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "EvidenceInputError";
  }
}

/** ISO source dates sort chronologically; absent dates are last, ties deterministic. */
function latestFirst<T extends { id: string }>(
  records: readonly T[],
  getDate: (record: T) => string | null,
): T[] {
  return [...records].sort(
    (a, b) =>
      (getDate(b) ?? "").localeCompare(getDate(a) ?? "") ||
      a.id.localeCompare(b.id),
  );
}

function bounded<T extends { id: string }>(
  collection: Collection<T> | null | undefined,
  limit: number,
  getDate: (record: T) => string | null,
): BoundedCollection<T> {
  const records = latestFirst(collection?.records ?? [], getDate).slice(
    0,
    limit,
  );
  return {
    available: collection != null,
    total: collection?.total ?? null,
    returned: records.length,
    hasMore: collection != null && collection.total > records.length,
    records,
  };
}

export function getInspectionEvidence(
  ccn: string,
  rawLimit: string | number = DEFAULT_EVIDENCE_RECORDS,
  registry: MarketRegistry = markets,
): InspectionEvidence {
  if (!/^\d{6}$/.test(ccn))
    throw new EvidenceInputError(
      "Supply one six-digit CMS nursing-home certification number (CCN).",
    );
  const market = registry.find((entry) =>
    entry.providers.some(
      (provider) =>
        provider.state === entry.state &&
        provider.category === "nursing-home" &&
        provider.cms?.ccn === ccn,
    ),
  );
  const provider = market?.providers.find(
    (provider) =>
      provider.state === market.state &&
      provider.category === "nursing-home" &&
      provider.cms?.ccn === ccn,
  );
  if (!provider)
    throw new EvidenceInputError(
      "This CCN is not a nursing home in a reviewed market catalog.",
      404,
    );
  const value = String(rawLimit);
  const limit = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_EVIDENCE_RECORDS
  ) {
    throw new EvidenceInputError(
      `Limit must be a whole number from 1 to ${MAX_EVIDENCE_RECORDS}.`,
    );
  }
  const snapshot = market?.inspectionHistory;
  if (!snapshot)
    throw new EvidenceInputError(
      "No retained inspection-history snapshot is available for this market.",
      404,
    );
  const facility = Object.hasOwn(snapshot.facilities, ccn)
    ? snapshot.facilities[ccn]
    : undefined;
  const healthCitations = bounded(
    facility?.healthCitations,
    limit,
    (row) => row.surveyDate,
  );
  return {
    ccn,
    providerName: provider.name,
    providerId: provider.id,
    careCompareUrl: `https://www.medicare.gov/care-compare/details/nursing-home/${ccn}`,
    retrieved: snapshot.retrieved,
    limit,
    maximumLimit: MAX_EVIDENCE_RECORDS,
    dictionaryUrl: snapshot.dictionaryUrl,
    scopeSeverityGuideUrl: SCOPE_SEVERITY_GUIDE_URL,
    sources: snapshot.sources,
    healthCitations: {
      ...healthCitations,
      records: healthCitations.records.map((row) => ({
        ...row,
        scopeSeverityLabel: scopeSeverityLabel(row.scopeSeverityCode),
      })),
    },
    penalties: {
      ...bounded(facility?.penalties, limit, (row) => row.date),
      fineCount: facility?.penalties?.fineCount ?? null,
      paymentDenialCount: facility?.penalties?.paymentDenialCount ?? null,
    },
  };
}
