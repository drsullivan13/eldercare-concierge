export type DailyLifeNumeric = {
  value: number;
  unit: "hours-per-day" | "staff-to-resident-ratio" | "hours-per-resident-day";
  population: string;
  period: string | null;
};

type DailyLifeSource = {
  id: string;
  url: string;
  title: string;
  publisher: string;
  checkedAt: string;
  publishedAt: string | null;
  access: "full-page";
  excerpt: string;
  locationEvidence: string;
};

export type DailyLifeFact = {
  id: string;
  text: string;
  quote: string;
  sourceId: string;
  evidence: "provider-reported";
} & (
  | { kind: "staffing"; numeric: DailyLifeNumeric }
  | {
      kind: "dining" | "care-support" | "activity" | "trip" | "transport";
      numeric?: never;
    }
);

export type DailyLifeResearch = {
  providerId: string;
  checkedAt: string;
  sources: DailyLifeSource[];
  facts: DailyLifeFact[];
  notes: string[];
};
