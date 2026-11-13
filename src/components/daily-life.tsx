import type { LocationResearchResponse } from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import { dailyLife } from "@/lib/daily-life-display";
import { amenityPoints } from "@/lib/amenity-points";
import { evidenceDate } from "./evidence-date";
import { Staffing } from "./staffing";
import "./daily-life.css";

export function DailyLife({
  data,
  provider,
  section,
}: {
  data: Pick<
    LocationResearchResponse,
    "facts" | "sources" | "dailyLife" | "nursingStaffing"
  >;
  provider: Provider;
  section: "amenities" | "care";
}) {
  const {
    office,
    groups: everydayGroups,
    gaps,
    publishedRatio,
  } = dailyLife(data, provider);
  const groups = everydayGroups.filter((group) =>
    section === "care"
      ? group.id === "staffing" || group.id === "care"
      : group.id !== "staffing" && group.id !== "care",
  );
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
  const retained = groups.flatMap((group) => group.facts);
  const sourceEntries = [
    ...new Set(retained.map(({ source }) => source.url)),
  ].map((url, index) => ({
    url,
    number: index + 1,
    entries: retained.filter(({ source }) => source.url === url),
  }));
  return (
    <div className={`daily-life daily-life-${section}`}>
      {groups.map((group) => {
        const points = group.facts.flatMap(({ fact, source }) =>
          amenityPoints(fact.text).map((text, index, bullets) => ({
            fact,
            source,
            text,
            index,
            last: index === bullets.length - 1,
          })),
        );
        return (
          <section
            className="daily-life-group"
            key={group.id}
            aria-label={group.title}
          >
            <h5>{group.title}</h5>
            <ul className="daily-life-bullets">
              {points.map(({ fact, source, text, index, last }) => (
                <li
                  key={`${fact.id}-${index}`}
                  className={`offering-fact daily-life-fact fact-${fact.kind}`}
                >
                  <span className="daily-life-bullet-text">{text}</span>
                  <sup className="daily-life-attribution">
                    {" "}
                    [
                    {
                      sourceEntries.find((entry) => entry.url === source.url)!
                        .number
                    }
                    {source.access === "search-result" ? ", search only" : ""}]
                  </sup>
                  {fact.numeric && last && (
                    <p className="daily-life-date">
                      Source scope · {fact.numeric.population}
                      {fact.numeric.period
                        ? ` · ${fact.numeric.period}`
                        : " · period not published"}
                      {fact.numeric.unit === "hours-per-day" &&
                        " · coverage hours, not a staff-to-resident ratio"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {section === "care" && <Staffing staffing={staffing} />}
      {sourceEntries.length > 0 && (
        <details className="daily-life-sources">
          <summary>Sources &amp; full wording</summary>
          <p>
            Reported offerings, not independently verified. Confirm current
            availability, included services and extra charges with the location.
            Search-only evidence has not been checked on the full page.
          </p>
          {sourceEntries.map(({ url, number, entries }) => (
            <section key={url} aria-label={`Source ${number}`}>
              <a
                className="research-source"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                [{number}]{" "}
                {entries[0].source.kind === "provider"
                  ? "Provider"
                  : entries[0].source.kind === "public-discussion"
                    ? "Public discussion"
                    : "Third-party listing"}{" "}
                · {entries[0].source.publisher} · {entries[0].source.title}
              </a>
              {entries.map(({ fact, source }) => (
                <div key={fact.id} className="daily-life-source-fact">
                  <p>{fact.text}</p>
                  <p className="daily-life-date">
                    Checked {evidenceDate(source.checkedAt)}
                    {source.access === "search-result"
                      ? " · search result only"
                      : ""}
                    {fact.asOf &&
                      ` · ${fact.evidence ? "Source publication date" : "Source effective date"} · ${evidenceDate(fact.asOf)}`}
                  </p>
                </div>
              ))}
            </section>
          ))}
        </details>
      )}
      <div className="daily-life-gaps">
        {section === "amenities" && !groups.length && (
          <p>
            No source-linked everyday-life offerings are established for this{" "}
            {office ? "service" : "location"} yet. Licensing and capacity do not
            establish amenities.
          </p>
        )}
        {section === "amenities" && gaps.length > 0 && (
          <p>
            <strong>Not established in the retained sources</strong> ·{" "}
            {gaps.join("; ")}.
          </p>
        )}
        {section === "care" && !hasHours && !publishedRatio && (
          <p>
            Staff levels and staff-to-resident ratios are not established here.{" "}
            {office
              ? "Confirm the assigned roles, visit length and backup coverage."
              : "Ask for staffing by role and shift, including overnight coverage."}
          </p>
        )}
        {section === "care" && hasHours && !publishedRatio && (
          <p>
            Shift-by-shift staffing and a simultaneous staff-to-resident ratio
            are not established here.
          </p>
        )}
        {section === "care" && publishedRatio && (
          <p>
            The published staffing claim above applies only to the roles, care
            unit and schedule its source specifies. Confirm current coverage; it
            is not a guarantee for every shift.
          </p>
        )}
      </div>
    </div>
  );
}
