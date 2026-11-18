import snapshot from "@/data/nj-coreq.json";
import type { Provider } from "@/lib/providers";
import { exactNjNursingFacilityCcn, formatCoreqPercent } from "@/lib/nj-coreq";

const currentSource = snapshot.source;
const historicalSource = snapshot.historical.source;
const currentResults: Record<
  string,
  (typeof snapshot.results)[keyof typeof snapshot.results]
> = snapshot.results;
const historicalResults: Record<
  string,
  (typeof snapshot.historical.results)[keyof typeof snapshot.historical.results]
> = snapshot.historical.results;

export function NjCoreqSurvey({ provider }: { provider: Provider }) {
  const ccn = exactNjNursingFacilityCcn(provider);
  if (
    !ccn ||
    (!Object.hasOwn(currentResults, ccn) &&
      !Object.hasOwn(historicalResults, ccn))
  ) {
    return null;
  }
  const historical = !Object.hasOwn(currentResults, ccn);
  const result = historical ? historicalResults[ccn] : currentResults[ccn];
  const source = historical ? historicalSource : currentSource;
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
          <strong>{formatCoreqPercent(result.value)}</strong>
          <span>CoreQ satisfaction composite</span>
        </div>
      </div>
      <p className="small muted">
        {historical && "Historical result. "}
        {source.reportingYear} reporting/payment year, not the survey year.
        Separate from Harbor experience and clinical quality ratings.
      </p>
      {historical && (
        <p className="small muted">
          No publishable FY2027 CoreQ result. The FY2027 workbook reports{" "}
          {historicalResults[ccn].currentSuppression.raw}.{" "}
          {historicalResults[ccn].currentSuppression.meaning} This FY2026 result
          does not fill that suppression or describe current satisfaction.
        </p>
      )}
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
        {historical && (
          <p>
            FY2027 suppression in sheet “{currentSource.workbook.sheet}”, cell{" "}
            {historicalResults[ccn].currentSuppression.cell}. The fiscal years
            do not establish survey dates or a trend.
          </p>
        )}
      </details>
      <div className="hh-source-links">
        <a href={source.workbook.url} target="_blank" rel="noreferrer">
          NJ DHS {source.reportingYear} workbook
        </a>
        {historical && (
          <a href={currentSource.workbook.url} target="_blank" rel="noreferrer">
            NJ DHS FY2027 workbook
          </a>
        )}
        <a href={source.definitionUrl} target="_blank" rel="noreferrer">
          NJ DHS CoreQ definition
        </a>
      </div>
    </section>
  );
}
