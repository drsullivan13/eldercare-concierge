import type {
  ExperienceReviewSample,
  ExperienceSummary,
} from "./experience-score";
import type { HomeCareOfficeIdentifiers } from "./home-care-office-identifiers";
import type { RegistrationFacts } from "./providers";
import type { PublicExperience } from "./public-experience";
import type {
  FacebookResearch,
  FacebookSummary,
  FamilyExperience,
} from "./facebook-research";
import type { DailyLifeResearch } from "./daily-life-types";
import type { NursingStaffingResearch } from "./nursing-staffing-types";

export type ResearchSource = {
  id: string;
  url: string;
  title: string;
  publisher: string;
  kind:
    | "provider"
    | "regulator"
    | "public-directory"
    | "review-platform"
    | "public-discussion";
  checkedAt: string;
  publishedAt: string | null;
  access: "full-page" | "search-result" | "pdf";
  excerpt?: string;
};
export type OfferingFact = {
  id: string;
  kind:
    | "care"
    | "amenity"
    | "activity"
    | "dining"
    | "room"
    | "cost"
    | "availability"
    | "capacity";
  text: string;
  sourceId: string;
  numericValue?: number | null;
  unit?: string;
  asOf?: string | null;
  amount?: {
    min: number;
    max: number | null;
    currency: "USD";
    period: "month" | "day" | "hour" | "one-time";
    type: "base-rent" | "care-fee" | "entrance-fee" | "other";
    asOf: string | null;
  } | null;
};
export type OfficeDirectoryResearch = {
  providerId: string;
  office: { name: string; address: string };
  source: ResearchSource;
  services: string[];
  paymentOptions: string[];
  accreditations?: string[];
  awards: { name: "Provider of Choice"; years: number[] }[];
};
type AvailabilityObservation = {
  status:
    | "opening-published"
    | "waitlist-published"
    | "inquiry-only"
    | "not-published";
  text: string;
  sourceId: string | null;
  asOf: string | null;
};
type ReviewAggregate = {
  sourceId: string;
  platform: string;
  sourceFamily: string;
  rating: number | null;
  scale: number | null;
  count: number | null;
  asOf: string | null;
  scope: string;
  notes: string[];
};
type PublicReview = {
  id: string;
  sourceId: string;
  url: string;
  date: string | null;
  rating: number | null;
  scale: number | null;
  relationship: "family" | "resident" | "staff" | "visitor" | "unknown";
  excerpt: string;
  summary: string;
  aspects: { aspect: string; sentiment: "positive" | "negative" | "mixed" }[];
  notes: string[];
};
export type LocationResearch = {
  providerId: string;
  checkedAt: string | null;
  providerDetailsReviewed: boolean;
  sources: ResearchSource[];
  facts: OfferingFact[];
  availability: AvailabilityObservation;
  reviewAggregates: ReviewAggregate[];
  reviews: PublicReview[];
  reviewSamples?: ExperienceReviewSample[];
  reviewLinks?: { publisher: string; url: string }[];
  notes: string[];
  admissionRestriction?: { text: string; sourceId: string };
};
export type ResearchSummary = {
  individualReviews?: { total: number; withText: number };
  familyExperience?: FamilyExperience;
  facebookResearch?: FacebookSummary;
  detailsAvailable: boolean;
  publishedCosts: number;
  availabilityStatus: AvailabilityObservation["status"];
  availabilityCheckedAt: string | null;
  admissionRestriction?: string;
  experience: PublicExperience;
};
export type InternalLocationResearchResponse = LocationResearch & {
  registrationFacts?: RegistrationFacts;
  officeDirectories?: OfficeDirectoryResearch[];
  officeIdentifiers?: HomeCareOfficeIdentifiers;
  dailyLife?: DailyLifeResearch;
  nursingStaffing?: NursingStaffingResearch;
  familyExperience?: FamilyExperience;
  experience: ExperienceSummary;
  facebookResearch?: FacebookResearch;
};
export type LocationResearchResponse = Omit<
  InternalLocationResearchResponse,
  "experience" | "reviewSamples" | "reviewAggregates"
> & {
  experience: PublicExperience;
  reviewAggregates: Omit<ReviewAggregate, "sourceFamily">[];
};
