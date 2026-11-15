import cards from "@/data/nj-coreq-cards.json";
import type { Provider } from "@/lib/providers";

export const coreqReportingYear = cards.reportingYear;
const values: Record<string, number> = cards.values;

export function exactNjNursingFacilityCcn(provider: Provider) {
  const ccn = provider.cms?.ccn;
  return provider.category === "nursing-home" &&
    provider.state === "NJ" &&
    provider.officialRecord &&
    provider.locationKind === "facility" &&
    ccn &&
    provider.id === `cms-${ccn}`
    ? ccn
    : null;
}

export function currentNjCoreqValue(provider: Provider) {
  const ccn = exactNjNursingFacilityCcn(provider);
  return ccn && Object.hasOwn(values, ccn) ? values[ccn] : null;
}

export const formatCoreqPercent = (value: number) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
