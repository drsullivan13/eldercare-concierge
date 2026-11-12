"use client";

import { useId } from "react";
import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import { ExternalLink, MessageSquare, Activity } from "lucide-react";
import type { HomeHealthEvidenceResponse } from "@/lib/home-health";

type Metric =
  HomeHealthEvidenceResponse["agencies"][number]["patientExperience"]["summaryStarRating"];

function dateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function PublishedValue({
  metric,
  suffix = "",
  definitions,
}: {
  metric: Metric;
  suffix?: string;
  definitions: Record<string, string>;
}) {
  return (
    <>
      <span>
        {metric.value === null
          ? "Not published"
          : `${metric.value.toLocaleString("en-US")}${suffix}`}
      </span>
      {metric.footnoteCodes.map((code) => (
        <small className="hh-footnote" key={code}>
          CMS note {code}:{" "}
          {definitions[code] ?? "See the CMS data dictionary for this note."}
        </small>
      ))}
      {metric.value === null && metric.footnoteCodes.length === 0 && (
        <small className="hh-footnote">
          CMS did not publish a value in this release.
        </small>
      )}
    </>
  );
}

const source = {
  path: "/api/home-health-evidence",
  idParameter: "providerId",
  unavailable: "The published home-health snapshot could not be loaded.",
  notFound:
    "No matched CMS home-health evidence is available for this organization in our snapshot.",
  mismatched: "The evidence response did not match this organization.",
  fallback: "The home-health snapshot could not be loaded.",
};

export function HomeHealthEvidence({ providerId }: { providerId: string }) {
  const headingId = useId();
  const { data, error, loading, retry } =
    useProviderEvidence<HomeHealthEvidenceResponse>(providerId, source);

  return (
    <section className="home-health-evidence" aria-labelledby={headingId}>
      <div className="section-title">
        <h3 id={headingId}>Home-health quality & patient experience</h3>
      </div>
      {loading && (
        <p className="small muted" role="status">
          Loading the published CMS home-health snapshot…
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button button-outline"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="small muted">
            CMS release: {dateLabel(data.releasedAt)} · Retrieved{" "}
            {dateLabel(data.retrieved)}. Clinical quality and patient experience
            are separate measures.
          </p>
          {data.agencies.length > 1 && (
            <div className="inline-notice">
              <strong>
                This organization has {data.agencies.length} matched CMS
                agencies.
              </strong>
              <p>
                Each has its own results. Confirm which agency would provide the
                care.
              </p>
            </div>
          )}
          {data.agencies.map((agency) => (
            <article
              className="hh-agency"
              key={agency.ccn}
              data-ccn={agency.ccn}
            >
              <header>
                <span className="eyebrow">CMS AGENCY · {agency.ccn}</span>
                <h4>{agency.cmsProviderName}</h4>
                <p className="small muted">
                  {agency.cmsAddress.street}, {agency.cmsAddress.city},{" "}
                  {agency.cmsAddress.state} {agency.cmsAddress.zip}
                </p>
                <p className="small">
                  Results apply to this Medicare-certified agency, which may
                  include multiple offices. They do not rate every affiliate or
                  the organization’s separate private-care services.
                </p>
              </header>
              <div className="hh-ratings">
                <div>
                  <Activity size={18} />
                  <span>Quality of patient care</span>
                  <strong>
                    <PublishedValue
                      metric={agency.qualityOfPatientCare.starRating}
                      suffix=" / 5"
                      definitions={data.footnoteDefinitions}
                    />
                  </strong>
                  <small>Care processes & clinical outcomes</small>
                </div>
                <div>
                  <MessageSquare size={18} />
                  <span>Patient experience</span>
                  <strong>
                    <PublishedValue
                      metric={agency.patientExperience.summaryStarRating}
                      suffix=" / 5"
                      definitions={data.footnoteDefinitions}
                    />
                  </strong>
                  <small>HHCAHPS patient survey</small>
                </div>
              </div>
              <h5>What patients reported</h5>
              <p className="small muted">
                Survey period: {agency.patientExperience.period.label}
              </p>
              <div className="hh-survey-context">
                <div>
                  <strong>
                    <PublishedValue
                      metric={agency.patientExperience.completedSurveys}
                      definitions={data.footnoteDefinitions}
                    />
                  </strong>
                  <span>completed surveys</span>
                </div>
                <div>
                  <strong>
                    <PublishedValue
                      metric={agency.patientExperience.responseRate}
                      suffix="%"
                      definitions={data.footnoteDefinitions}
                    />
                  </strong>
                  <span>response rate</span>
                </div>
              </div>
              {agency.patientExperience.generalFootnoteCodes.map((code) => (
                <p className="small hh-footnote" key={code}>
                  CMS survey note {code}:{" "}
                  {data.footnoteDefinitions[code] ??
                    "See the CMS data dictionary."}
                </p>
              ))}
              <dl className="hh-measures">
                {agency.patientExperience.measures.map((measure) => (
                  <div key={measure.id}>
                    <dt>{measure.label}</dt>
                    <dd>
                      <PublishedValue
                        metric={measure.percent}
                        suffix="%"
                        definitions={data.footnoteDefinitions}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="small muted">
                These results reflect participating respondents. The completion
                count is not the number answering every question. Published
                percentages include CMS adjustments; a small difference does not
                establish better care for a particular person.
              </p>
              <details className="hh-clinical-details">
                <summary>See the clinical quality measures</summary>
                <p className="small muted">
                  {agency.qualityOfPatientCare.measurementPeriodNote}
                </p>
                <dl className="hh-measures">
                  {agency.qualityOfPatientCare.components.map((measure) => (
                    <div key={measure.id}>
                      <dt>
                        {measure.label}
                        <small>
                          {measure.period.label} ·{" "}
                          {measure.betterDirection === "lower"
                            ? "Lower is better"
                            : "Higher is better"}
                        </small>
                      </dt>
                      <dd>
                        <PublishedValue
                          metric={measure.rate}
                          suffix="%"
                          definitions={data.footnoteDefinitions}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="small muted">
                  Rates are published by CMS. Outcome measures account for
                  differences in patient needs; the timely-start measure is a
                  care-process measure. These results do not confirm current
                  staffing, openings or fit for a specific care need.
                </p>
              </details>
            </article>
          ))}
          <div className="hh-source-links">
            <a
              href="https://data.cms.gov/provider-data/dataset/ccn4-8vby"
              target="_blank"
              rel="noreferrer"
            >
              CMS patient survey data <ExternalLink size={14} />
            </a>
            <a
              href="https://data.cms.gov/provider-data/dataset/6jpm-sxkc"
              target="_blank"
              rel="noreferrer"
            >
              CMS home-health clinical data <ExternalLink size={14} />
            </a>
            <a
              href="https://data.cms.gov/provider-data/sites/default/files/data_dictionaries/home_health/HHS_Data_Dictionary.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Measure definitions & reporting notes <ExternalLink size={14} />
            </a>
          </div>
        </>
      )}
    </section>
  );
}
