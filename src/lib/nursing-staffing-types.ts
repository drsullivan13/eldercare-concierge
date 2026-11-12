type StaffingPeriod = {
  startDate: string;
  endDate: string;
  label: string;
  sourceUrl: string;
};

type StaffingMetric = {
  unit: "hours per resident-day" | "percent" | "residents per day";
  sourceField: string;
  footnote: string | null;
} & (
  | { status: "reported"; value: number }
  | { status: "unavailable" | "suppressed"; value: null }
);

export type NursingStaffingResearch = {
  providerId: string;
  ccn: string;
  providerName: string;
  state: string;
  sourceUrl: string;
  careCompareUrl: string;
  retrievedAt: string;
  processingDate: string;
  staffingPeriod: StaffingPeriod;
  turnoverPeriod: StaffingPeriod;
  staffingRatingNote: string | null;
  dictionaryUrl: string;
  sourceReceipt: { file: string; sha256: string; rowIndex: number };
  metrics: Record<
    | "total"
    | "rn"
    | "lpn"
    | "aide"
    | "weekendTotal"
    | "weekendRn"
    | "totalTurnover"
    | "rnTurnover"
    | "census",
    StaffingMetric
  >;
};
