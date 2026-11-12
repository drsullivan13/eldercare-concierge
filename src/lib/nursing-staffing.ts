import snapshot from "@/data/nursing-staffing.json";
import { getProviderMarket } from "./markets";
import type { NursingStaffingResearch } from "./nursing-staffing-types";

type MetricKey = keyof NursingStaffingResearch["metrics"];
type Snapshot = {
  dictionaryUrl: string;
  metricDefinitions: Record<
    MetricKey,
    {
      sourceField: string;
      unit: NursingStaffingResearch["metrics"][MetricKey]["unit"];
    }
  >;
  periods: Record<string, NursingStaffingResearch["staffingPeriod"]>;
  sources: Record<string, { file: string; sha256: string }>;
  providers: Record<
    string,
    Omit<
      NursingStaffingResearch,
      | "providerId"
      | "careCompareUrl"
      | "staffingPeriod"
      | "turnoverPeriod"
      | "dictionaryUrl"
      | "sourceReceipt"
    > & { sourceId: string; sourceRow: number }
  >;
};

const evidence = snapshot as unknown as Snapshot;

export function getNursingStaffingResearch(
  providerId: string,
): NursingStaffingResearch | null {
  const provider = getProviderMarket(providerId)?.providers.find(
    (entry) => entry.id === providerId,
  );
  if (
    provider?.category !== "nursing-home" ||
    !provider.cms ||
    !Object.hasOwn(evidence.providers, providerId)
  )
    return null;
  const record = evidence.providers[providerId];
  if (record.ccn !== provider.cms.ccn || record.state !== provider.state)
    return null;
  const staffingPeriod =
    evidence.periods[`${record.processingDate}/STAFFING_LEVELS`];
  const turnoverPeriod =
    evidence.periods[`${record.processingDate}/STAFFING_TURNOVER`];
  const source = evidence.sources[record.sourceId];
  if (!staffingPeriod || !turnoverPeriod || !source) return null;
  const metrics = { ...record.metrics };
  for (const key of Object.keys(metrics) as MetricKey[]) {
    metrics[key] = { ...metrics[key], ...evidence.metricDefinitions[key] };
  }
  return {
    providerId,
    ccn: record.ccn,
    providerName: record.providerName,
    state: record.state,
    sourceUrl: record.sourceUrl,
    careCompareUrl: `https://www.medicare.gov/care-compare/details/nursing-home/${record.ccn}`,
    retrievedAt: record.retrievedAt,
    processingDate: record.processingDate,
    staffingPeriod: { ...staffingPeriod },
    turnoverPeriod: { ...turnoverPeriod },
    staffingRatingNote: record.staffingRatingNote,
    dictionaryUrl: evidence.dictionaryUrl,
    sourceReceipt: {
      file: source.file,
      sha256: source.sha256,
      rowIndex: record.sourceRow,
    },
    metrics,
  };
}
