import type { ResearchSummary } from "./location-research-types";
import type { Market } from "./market-types";
import type { LocationDescriptionResponse } from "./location-description-types";
export type CareCategory =
  | "nursing-home"
  | "assisted-living"
  | "home-care"
  | "home-health"
  | "staffing"
  | "life-plan";
export const CATEGORY_LABELS: Record<CareCategory, string> = {
  "nursing-home": "Nursing & rehabilitation",
  "assisted-living": "Assisted living",
  "home-care": "Help at home",
  "home-health": "Skilled home health",
  staffing: "Private staff sourcing",
  "life-plan": "Continuing & tiered care",
};
type Source = {
  title: string;
  publisher: string;
  url: string;
  kind:
    | "regulatory"
    | "inspection"
    | "staffing"
    | "provider"
    | "directory"
    | "experience";
  checkedAt: string;
  dataAsOf?: string;
  supports: string;
};
/** Source-listed business facts as captured on the check date, not a current verification. */
export type RegistrationFacts = {
  registration: string;
  businessName: string;
  dbas?: string;
  licenseType: string;
  status: string;
  expiresOn: string | null;
  source: {
    title: string;
    publisher: string;
    url: string;
    checkedAt: string;
  };
};
export type Provider = {
  id: string;
  name: string;
  category: CareCategory;
  searchCategories?: CareCategory[];
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  locationKind: "facility" | "office" | "zip";
  phone?: string;
  website?: string;
  description: string;
  /** Per-office editorial publication; null means no approved description. */
  locationDescription?: LocationDescriptionResponse | null;
  services: string[];
  serviceArea?: string;
  /** Published provider-reported coverage, not confirmation of an individual address or vacancy. */
  serviceAreaZips?: string[];
  capacity?: number;
  ownership?: string;
  officialRecord: boolean;
  cms?: {
    ccn: string;
    overall: number | null;
    inspections: number | null;
    staffing: number | null;
    quality: number | null;
    totalNurseHours: number | null;
    rnHours: number | null;
    turnover: number | null;
    fines: number | null;
    fineAmount: number | null;
    paymentDenials: number | null;
    healthDeficiencies: number | null;
    lastInspection?: string;
    abuse: boolean;
    specialFocus: string | null;
    dataAsOf: string;
  };
  sources: Source[];
  warnings: string[];
  limitations: string[];
  research?: ResearchSummary;
};
export type SearchProvider = Provider & {
  distanceMiles: number | null;
  /** The searched ZIP is in the published provider-reported area, not verified address coverage or vacancy. */
  serviceAreaMatch?: boolean;
};
/** Display fields only; opening or comparing a card resolves its full provider. */
export type SearchCard = Pick<
  SearchProvider,
  | "id"
  | "name"
  | "category"
  | "city"
  | "state"
  | "zip"
  | "lat"
  | "lng"
  | "locationKind"
  | "distanceMiles"
  | "serviceAreaMatch"
  | "services"
  | "warnings"
  | "cms"
  | "research"
> & {
  coreqPercent: number | null;
  locationDescription?: { summary: string };
};
export type CardSearchResponse = Omit<CompactSearchResponse, "providers"> & {
  providers: SearchCard[];
};
export function matchesHomeCareServiceArea(
  provider: Pick<Provider, "category" | "serviceAreaZips">,
  zip: string,
  category: CareCategory | "all",
): boolean {
  return (
    category === "home-care" &&
    provider.category === "home-care" &&
    provider.serviceAreaZips?.includes(zip) === true
  );
}
export function isServiceProvider(provider: Pick<Provider, "category">) {
  return (
    provider.category === "home-care" ||
    provider.category === "home-health" ||
    provider.category === "staffing"
  );
}

export function usesReviewedHomeCareDescription(
  provider: Pick<Provider, "id" | "category">,
) {
  return (
    provider.category === "home-care" && provider.id.startsWith("north-jersey-")
  );
}

export type SearchResponse = {
  market: Market;
  providers: SearchProvider[];
  total: number;
  origin: { zip: string; city: string; lat: number; lng: number };
  radius: number;
  catalogTotal: number;
  asOf: string;
  categories: Record<string, number>;
  excludedWithoutCoordinates: number;
  experienceCoverage: {
    scored: number;
    unscored: number;
    facebookFindings: number;
    facebookCovered: number;
  };
};
/** Complete ordered search index, including service-area matches without coordinates. */
export type SearchMarker = Pick<
  SearchProvider,
  | "id"
  | "name"
  | "category"
  | "city"
  | "state"
  | "lat"
  | "lng"
  | "locationKind"
  | "distanceMiles"
  | "serviceAreaMatch"
>;
export type CompactSearchResponse = Omit<SearchResponse, "providers"> & {
  providers: SearchProvider[];
  /** Complete index is included only on the first page. */
  markers?: SearchMarker[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    hasMore: boolean;
  };
};
export function formatPhone(phone?: string) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : phone;
}
