import inquiryRoutes from "../data/inputs/nj-home-care-inquiry-routes.json";
import type { LocationResearch } from "./location-research-types";
import type { Provider } from "./providers";

/** Public-page recheck intervals, not guarantees of current agency capacity. */
const MAX_AGE_DAYS = {
  intake: 30,
  "minimum-hours": 30,
  "earliest-start": 1,
  "service-zips": 90,
};
type Field = keyof typeof MAX_AGE_DAYS;
type EvidenceSource = {
  url: string;
  checkedAt: string;
  expiresAt: string;
  destination?: string;
};
type Claim = { value: string; url: string; checkedAt: string };
type OfficeFact = {
  field: Field;
  state: "known" | "unknown" | "stale" | "conflicting";
  value?: string;
  sources: EvidenceSource[];
  staleSources?: EvidenceSource[];
};
type RouteOffice =
  (typeof inquiryRoutes.offices)[keyof typeof inquiryRoutes.offices];
const offices: Readonly<Record<string, RouteOffice>> = inquiryRoutes.offices;
const DAY = 86_400_000;
function day(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : null;
}
function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function resolve(field: Field, claims: Claim[], at: string): OfficeFact {
  const now = day(at);
  const usable = claims.filter(
    (claim) =>
      safeUrl(claim.url) &&
      day(claim.checkedAt) !== null &&
      now !== null &&
      day(claim.checkedAt)! <= now,
  );
  const sources = usable.map((claim) => ({
    url: claim.url,
    checkedAt: claim.checkedAt,
    ...(field === "intake" ? { destination: claim.value } : {}),
    expiresAt: new Date(day(claim.checkedAt)! + MAX_AGE_DAYS[field] * DAY)
      .toISOString()
      .slice(0, 10),
  }));
  if (!usable.length) return { field, state: "unknown", sources: [] };
  if (field === "intake") {
    const fresh = sources.filter((source) => now! < day(source.expiresAt)!);
    const stale = sources.filter((source) => now! >= day(source.expiresAt)!);
    return fresh.length
      ? {
          field,
          state: "known",
          value: [...new Set(fresh.map((source) => source.destination!))]
            .sort()
            .join("; "),
          sources: fresh,
          ...(stale.length ? { staleSources: stale } : {}),
        }
      : { field, state: "stale", sources: stale };
  }
  // Contradiction is held for review even if one publisher's observation is older.
  if (new Set(usable.map((claim) => claim.value)).size > 1)
    return { field, state: "conflicting", sources };
  const fresh = sources.some((source) => now! < day(source.expiresAt)!);
  return {
    field,
    state: fresh ? "known" : "stale",
    ...(fresh ? { value: usable[0].value } : {}),
    sources,
  };
}

export const OFFICE_FACT_LABELS: Record<Field, string> = {
  intake: "Public inquiry route",
  "minimum-hours": "Minimum hours",
  "earliest-start": "Earliest care start",
  "service-zips": "Published service ZIPs",
};

/** Only reviewed public sources enter here. Never accepts consultation or workspace records. */
export function publicOfficeEvidence(
  provider: Provider,
  research?: Pick<LocationResearch, "providerId" | "facts" | "sources">,
  at = new Date().toISOString().slice(0, 10),
) {
  if (
    provider.category !== "home-care" ||
    provider.state !== "NJ" ||
    provider.locationKind !== "office" ||
    !/^north-jersey-hp-hp\d{7}$/.test(provider.id)
  )
    return null;
  const claims: Record<Field, Claim[]> = {
    intake: [],
    "minimum-hours": [],
    "earliest-start": [],
    "service-zips": [],
  };
  // This reviewed input already binds each route to one registration, not a brand.
  const office = Object.hasOwn(offices, provider.id)
    ? offices[provider.id]
    : undefined;
  if (office?.routes.length) {
    for (const route of office.routes) {
      const destination = "address" in route ? route.address : route.href;
      // A destination cannot borrow the check date of another email or form.
      if (
        !("address" in route
          ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)
          : safeUrl(destination))
      )
        continue;
      claims.intake.push({
        value: destination,
        url: route.sourceUrl,
        checkedAt: route.checkedAt,
      });
    }
  }
  if (provider.serviceAreaZips?.length) {
    // ZIP values are the existing conservative geographic release; office ZIP is never coverage.
    for (const source of provider.sources.filter(
      (source) =>
        source.kind === "provider" &&
        /\bserviceArea \(retained research\/north-jersey\//.test(
          source.supports,
        ),
    )) {
      claims["service-zips"].push({
        value: [...provider.serviceAreaZips].sort().join(", "),
        url: source.url,
        checkedAt: source.checkedAt,
      });
    }
  }
  if (research?.providerId === provider.id) {
    for (const fact of research.facts) {
      const scope = fact.publicOfficeFact;
      if (
        !scope ||
        scope.officeAddress !== provider.address ||
        scope.officeZip !== provider.zip
      )
        continue;
      const source = research.sources.find(
        (source) => source.id === fact.sourceId,
      );
      if (
        !source ||
        source.kind !== "provider" ||
        source.access === "search-result" ||
        !source.excerpt?.includes(fact.text)
      )
        continue;
      // Editorial annotation identifies exact meaning; never infer start dates from appointment slots.
      claims[scope.field].push({
        value: fact.text,
        url: source.url,
        checkedAt: source.checkedAt,
      });
    }
  }
  return (Object.keys(claims) as Field[]).map((field) =>
    resolve(field, claims[field], at),
  );
}

/** Bounded public-only coordinator queue; a recheck is not authorized outreach. */
export function officeEvidenceReview(
  providers: Provider[],
  research: Record<string, LocationResearch> = {},
  at = new Date().toISOString().slice(0, 10),
  limit = 25,
) {
  const rows = providers.flatMap((provider) => {
    const facts = publicOfficeEvidence(provider, research[provider.id], at);
    return facts ? [{ providerId: provider.id, facts }] : [];
  });
  const counts = Object.fromEntries(
    (Object.keys(MAX_AGE_DAYS) as Field[]).map((field) => [
      field,
      Object.fromEntries(
        ["known", "unknown", "stale", "conflicting"].map((state) => [
          state,
          rows.filter((row) =>
            row.facts.some(
              (fact) => fact.field === field && fact.state === state,
            ),
          ).length,
        ]),
      ),
    ]),
  );
  const queue = rows.flatMap((row) =>
    row.facts
      .flatMap((fact): OfficeFact[] => [
        fact,
        ...(fact.staleSources?.length
          ? [
              {
                field: fact.field,
                state: "stale",
                sources: fact.staleSources,
              } as OfficeFact,
            ]
          : []),
      ])
      .filter((fact) => fact.state !== "known")
      .map((fact) => ({
        providerId: row.providerId,
        field: fact.field,
        reason: fact.state,
        action:
          fact.state === "conflicting"
            ? "Reconcile contradictory public office sources before release."
            : fact.state === "stale"
              ? "Recheck the exact office public source; retain the old observation date until reviewed."
              : "Find an explicit public office claim; otherwise leave unknown.",
        sources: fact.sources,
      })),
  );
  queue.sort(
    (a, b) =>
      ({ conflicting: 0, stale: 1, unknown: 2 })[
        a.reason as "conflicting" | "stale" | "unknown"
      ] -
        { conflicting: 0, stale: 1, unknown: 2 }[
          b.reason as "conflicting" | "stale" | "unknown"
        ] ||
      a.providerId.localeCompare(b.providerId) ||
      a.field.localeCompare(b.field),
  );
  const bounded = Math.max(
    0,
    Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 25),
  );
  return {
    asOf: at,
    eligibleOffices: rows.length,
    counts,
    staleIntakeRoutes: rows.reduce(
      (count, row) =>
        count +
        row.facts
          .filter((fact) => fact.field === "intake")
          .reduce(
            (sum, fact) =>
              sum +
              (fact.staleSources?.length ??
                (fact.state === "stale" ? fact.sources.length : 0)),
            0,
          ),
      0,
    ),
    totalReviewItems: queue.length,
    remainingReviewItems: Math.max(0, queue.length - bounded),
    review: queue.slice(0, bounded),
  };
}
