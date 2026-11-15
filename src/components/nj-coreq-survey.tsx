import snapshot from "@/data/nj-coreq.json";
import type { Provider } from "@/lib/providers";

const results: Record<
  string,
  (typeof snapshot.results)[keyof typeof snapshot.results]
> = snapshot.results;

export function NjCoreqSurvey({ provider }: { provider: Provider }) {
  const ccn = provider.cms?.ccn;
  if (
    provider.category !== "nursing-home" ||
    provider.state !== "NJ" ||
    !provider.officialRecord ||
    provider.locationKind !== "facility" ||
    !ccn ||
    provider.id !== `cms-${ccn}` ||
    !Object.hasOwn(results, ccn)
  ) {
    return null;
  }
  const result = results[ccn];
  const { source } = snapshot;
  return (
    <section
      className="home-health-evidence"
      aria-label="NJ resident & family survey"
    >
      <div className="section-title">
        <h3>NJ resident &amp; family survey</h3>
      </div>
      <p className="small muted">{source.population}.</p>
      <div className="hh-survey-context">
        <div>
          <strong>
            {result.value.toLocaleString("en-US", {
              maximumFractionDigits: 2,
            })}
            %
          </strong>
          <span>CoreQ satisfaction composite</span>
        </div>
      </div>
      <p className="small muted">
        {source.reportingYear} reporting/payment year, not the survey year.
        Separate from Harbor experience and clinical quality ratings.
      </p>
      <details className="evidence-disclosure">
        <summary>Source, scope &amp; definition</summary>
        <p>{source.definition}</p>
        <p>
          The percentage is the state-published composite, not a Harbor review
          average. The survey period and sample size are not published in this
          workbook.
        </p>
        <p>
          Matched certified nursing home: {result.identity.cmsName}. CMS CCN{" "}
          {ccn}. Medicaid Gainwell ID {result.identity.medicaidId}. This result
          does not describe other care settings or sister facilities.
        </p>
        <p>
          Workbook sheet “{source.workbook.sheet}”, cell {result.cell}. The
          workbook formats the composite as a percentage.
        </p>
      </details>
      <div className="hh-source-links">
        <a href={source.workbook.url} target="_blank" rel="noreferrer">
          NJ DHS FY2027 workbook
        </a>
        <a href={source.definitionUrl} target="_blank" rel="noreferrer">
          NJ DHS CoreQ definition
        </a>
      </div>
    </section>
  );
}
