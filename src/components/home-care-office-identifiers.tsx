import { ExternalLink } from "lucide-react";
import type { HomeCareOfficeIdentifiers as OfficeIdentifiers } from "@/lib/home-care-office-identifiers";
import { evidenceDate } from "./evidence-date";

export function HomeCareOfficeIdentifiers({
  data,
  uid,
}: {
  data: OfficeIdentifiers;
  uid: string;
}) {
  const directories = data.historicalDirectories ?? [];
  const organization = data.federalOrganization;
  if (!directories.length && !organization) return null;
  return (
    <details className="evidence-disclosure">
      <summary id={`${uid}-office-identifiers`}>Office source records</summary>
      <div aria-labelledby={`${uid}-office-identifiers`}>
        <p className="research-intro">
          Source records matched to this office only.
        </p>
        {directories.map((directory) => {
          const asOfDates = [
            ...new Set(directory.sources.map((source) => source.asOf)),
          ];
          return (
            <div
              key={`${directory.payer}-${directory.program}-${directory.checkedAt}`}
            >
              <h5>
                {directory.payer} · {directory.program}
              </h5>
              <p className="small muted">
                Historical directory listing · as of{" "}
                {asOfDates.map(evidenceDate).join(", ")}. Checked{" "}
                {evidenceDate(directory.checkedAt)}.
              </p>
              <ul className="research-specifics">
                {directory.sources.map((source) => (
                  <li
                    key={`${source.url}-${source.asOf}-${source.physicalPage}-${source.printedPage ?? ""}`}
                  >
                    <a
                      className="research-source"
                      href={`${source.url}#page=${source.physicalPage}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.printedPage && (
                        <>Printed page {source.printedPage} · </>
                      )}
                      physical PDF page {source.physicalPage}
                      {asOfDates.length > 1 && (
                        <> · as of {evidenceDate(source.asOf)}</>
                      )}
                      <ExternalLink size={12} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {directories.length > 0 && (
          <p className="small muted">
            Confirm current coverage, authorization and availability with the
            office and your plan.
          </p>
        )}
        {organization && (
          <>
            <h5>Federal organizational NPI</h5>
            <p>
              NPI {organization.npi} · {organization.legalName}
            </p>
            <a
              className="research-source"
              href={organization.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              CMS NPI Registry · record last updated{" "}
              {evidenceDate(organization.lastUpdated)}
              <ExternalLink size={12} />
            </a>
            <p className="small muted">
              An organizational identifier, not evidence of licensing,
              certification, services, insurance acceptance, availability or
              care quality.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
