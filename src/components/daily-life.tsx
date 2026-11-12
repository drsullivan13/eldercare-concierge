import type { LocationResearchResponse } from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import { dailyLife } from "@/lib/daily-life-display";
import { evidenceDate } from "./evidence-date";
import { Staffing } from "./staffing";
import "./daily-life.css";

export function DailyLife({
  data,
  provider,
  compact = false,
}: {
  data: Pick<
    LocationResearchResponse,
    "facts" | "sources" | "dailyLife" | "nursingStaffing"
  >;
  provider: Provider;
  compact?: boolean;
}) {
  const { office, groups, gaps, publishedRatio } = dailyLife(data, provider);
  const cms = provider.category === "nursing-home" ? provider.cms : undefined;
  const staffing =
    cms &&
    data.nursingStaffing?.providerId === provider.id &&
    data.nursingStaffing.ccn === cms.ccn
      ? data.nursingStaffing
      : undefined;
  const hasHours = Boolean(
    staffing &&
    (["total", "rn", "lpn", "aide"] as const).some(
      (role) => staffing.metrics[role].status === "reported",
    ),
  );
  return (
    <div className={`daily-life${compact ? " daily-life-compact" : ""}`}>
      {office && (
        <p className="daily-life-context">
          {provider.locationKind === "office"
            ? "An office that arranges care, not a residential community."
            : "A service-area listing, not a verified residential location."}{" "}
          Published services do not establish staff availability at your
          address.
        </p>
      )}
      {groups.map((group) => {
        const visible = compact ? group.facts.slice(0, 1) : group.facts;
        const renderFacts = (entries: typeof group.facts) =>
          entries.map(({ fact, source }) => (
            <article
              key={fact.id}
              className={`offering-fact daily-life-fact fact-${fact.kind}`}
            >
              <p>{fact.text}</p>
              {fact.numeric && (
                <p className="daily-life-date">
                  Source scope · {fact.numeric.population}
                  {fact.numeric.period
                    ? ` · ${fact.numeric.period}`
                    : " · period not published"}
                  {fact.numeric.unit === "hours-per-day" &&
                    " · coverage hours, not a staff-to-resident ratio"}
                </p>
              )}
              <a
                className="research-source"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.kind === "provider"
                  ? "Provider"
                  : source.kind === "public-discussion"
                    ? "Public discussion"
                    : "Third-party listing"}{" "}
                · {source.publisher} · checked {evidenceDate(source.checkedAt)}
                {source.access === "search-result"
                  ? " · search result only"
                  : ""}
              </a>
              {fact.asOf && (
                <p className="daily-life-date">
                  {fact.evidence
                    ? "Source publication date"
                    : "Source effective date"}{" "}
                  · {evidenceDate(fact.asOf)}
                </p>
              )}
            </article>
          ));
        return (
          <section
            className="daily-life-group"
            key={group.id}
            aria-label={group.title}
          >
            <h5>{group.title}</h5>
            {renderFacts(visible)}
            {compact && group.facts.length > 1 && (
              <details>
                <summary>
                  Show {group.facts.length - 1} more{" "}
                  {group.id === "staffing"
                    ? "care team facts"
                    : "published facts"}
                </summary>
                {renderFacts(group.facts.slice(1))}
              </details>
            )}
          </section>
        );
      })}
      <Staffing staffing={staffing} />
      <div className="daily-life-gaps">
        {!groups.length && (
          <p>
            No source-linked everyday-life offerings are established for this{" "}
            {office ? "service" : "location"} yet. Licensing and capacity do not
            establish amenities.
          </p>
        )}
        {gaps.length > 0 && (
          <p>
            <strong>Not established in the retained sources</strong> ·{" "}
            {gaps.join("; ")}.
          </p>
        )}
        {!hasHours && !publishedRatio && (
          <p>
            Staff levels and staff-to-resident ratios are not established here.{" "}
            {office
              ? "Confirm the assigned roles, visit length and backup coverage."
              : "Ask for staffing by role and shift, including overnight coverage."}
          </p>
        )}
        {hasHours && !publishedRatio && (
          <p>
            Shift-by-shift staffing and a simultaneous staff-to-resident ratio
            are not established here.
          </p>
        )}
        {publishedRatio && (
          <p>
            The published staffing claim above applies only to the roles, care
            unit and schedule its source specifies. Confirm current coverage; it
            is not a guarantee for every shift.
          </p>
        )}
      </div>
      {!compact && (
        <section
          className="daily-life-group daily-life-location"
          aria-label="Location & access"
        >
          <h5>{office ? "Service location & access" : "Location & access"}</h5>
          <p>
            {provider.address}
            {!provider.address
              .toLowerCase()
              .includes(provider.city.toLowerCase()) &&
              `, ${provider.city}, ${provider.state} ${provider.zip}`}
          </p>
          {provider.serviceArea && (
            <p>Listed service area · {provider.serviceArea}</p>
          )}
          <p>
            {office
              ? "Confirm service at your address and any travel charges."
              : "Accessible entrances, visitor transport and travel times are not established by the address."}
          </p>
          {provider.sources.slice(0, 1).map((source) => (
            <a
              key={source.url}
              className="research-source"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              Location source · {source.publisher} · checked{" "}
              {evidenceDate(source.checkedAt)}
            </a>
          ))}
        </section>
      )}
    </div>
  );
}
