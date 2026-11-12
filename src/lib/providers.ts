import type { ResearchSummary } from "./location-research-types";
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
  services: string[];
  serviceArea?: string;
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
export type SearchProvider = Provider & { distanceMiles: number | null };
export type SearchResponse = {
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
export function formatPhone(phone?: string) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : phone;
}
