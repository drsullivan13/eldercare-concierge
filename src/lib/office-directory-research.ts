import accreditation from "../data/home-care-accreditation-extension.json";
import activated from "../data/activated-insights-office-directory.json";
import associations from "../data/home-care-association-directories.json";
import type { OfficeDirectoryResearch } from "./location-research-types";

const byProvider = new Map<string, OfficeDirectoryResearch[]>();
for (const office of [
  ...activated.offices,
  ...accreditation.offices,
  ...associations.offices,
] as OfficeDirectoryResearch[]) {
  const records = byProvider.get(office.providerId) ?? [];
  if (records.some((record) => record.source.id === office.source.id))
    throw new Error("Duplicate office directory source.");
  records.push(office);
  byProvider.set(office.providerId, records);
}

export function getOfficeDirectoryResearch(providerId: string) {
  const records = byProvider.get(providerId);
  if (records) return structuredClone(records);
}
