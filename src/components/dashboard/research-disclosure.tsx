import { ArrowUpRight } from "lucide-react";
import type { SearchResponse } from "@/lib/providers";

export function ResearchDisclosure({
  data,
  filtered,
}: {
  data: SearchResponse;
  filtered: boolean;
}) {
  const hasOffices = data.providers.some(
    (provider) => provider.locationKind === "office",
  );
  return (
    <div className="search-research-summary">
      <p>
        {hasOffices
          ? "Office distances do not confirm service coverage at your address. Confirm coverage, availability, and care needs directly."
          : "Sources are linked in each option. Confirm current availability, costs, and care needs directly."}
      </p>
      <details className="search-research-disclosure">
        <summary>Research coverage & method</summary>
        <div className="search-research-content">
          <div aria-label="Experience research coverage">
            <p>
              <strong>
                {data.experienceCoverage.scored} of {data.total}
              </strong>{" "}
              results have an experience score.{" "}
              <strong>{data.experienceCoverage.facebookFindings}</strong>{" "}
              locations with Facebook findings.
            </p>
            <p>
              Unrated means more evidence is needed. Facebook findings add
              context; selected posts do not change the score.
            </p>
          </div>
          {filtered && (
            <p className="research-filter-note">
              Unresearched options may have the same offerings. Consumer scores
              summarize public ratings, not clinical quality or safety;
              published opening claims need direct confirmation.
            </p>
          )}
          <p>
            Official records and provider claims are labeled separately. No
            provider pays for placement. Results start with straight-line
            distance from an approximate ZIP location; an office in this radius
            does not establish service coverage.
          </p>
          <p className="catalog-note">
            {data.market.label} catalog as of {data.asOf}.{" "}
            {data.catalogTotal} records in this market. The catalog is not a
            complete inventory of local care.
            {data.excludedWithoutCoordinates > 0
              ? ` ${data.excludedWithoutCoordinates} records without usable location coordinates are excluded from radius results.`
              : ""}{" "}
            Sources and publication dates are inside each record.
          </p>
          <div className="search-research-links">
            <a
              className="text-link"
              href="/methodology"
              target="_blank"
              rel="noreferrer"
            >
              Methodology & sources <ArrowUpRight size={14} />
            </a>
            <a
              className="text-link"
              href={`/api/research-coverage?${new URLSearchParams({
                format: "csv",
                market: data.market.id,
              })}`}
              download
            >
              Download catalog research checklist <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </details>
    </div>
  );
}
