import release from "../data/home-care-office-identifiers.json";

export type HomeCareOfficeIdentifiers = {
  providerId: string;
  historicalDirectories?: {
    payer: string;
    program: string;
    checkedAt: string;
    sources: {
      url: string;
      asOf: string;
      physicalPage: number;
      printedPage?: string;
    }[];
  }[];
  federalOrganization?: {
    npi: string;
    legalName: string;
    lastUpdated: string;
    sourceUrl: string;
  };
};

const offices = new Map<string, HomeCareOfficeIdentifiers>(
  release.offices.map((office) => [office.providerId, office]),
);

export function getHomeCareOfficeIdentifiers(
  providerId: string,
): HomeCareOfficeIdentifiers | undefined {
  const office = offices.get(providerId);
  return office ? structuredClone(office) : undefined;
}
