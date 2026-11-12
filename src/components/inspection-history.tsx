"use client";

import { useEffect, useId, useState } from "react";
import { ExternalLink, FileCheck2 } from "lucide-react";
import type { InspectionEvidence } from "@/lib/inspections";

function dateLabel(value: string | null) {
  if (!value) return "Date not published";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function amountLabel(value: number | null) {
  return value === null
    ? "Not published"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
}

type LoadState = { key: string; data?: InspectionEvidence; error?: string };

/** Mount only for a nursing home's CMS CCN; the API revalidates catalog membership. */
export function InspectionHistory({ ccn }: { ccn: string }) {
  const headingId = useId();
  const [request, setRequest] = useState({ ccn, limit: 5 });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ key: "" });
  const limit = request.ccn === ccn ? request.limit : 5;
  const key = `${ccn}:${limit}:${attempt}`;
  const data = state.data?.ccn === ccn ? state.data : undefined;
  const loading = state.key !== key;
  const error = state.key === key ? state.error : undefined;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/evidence?${new URLSearchParams({ ccn, limit: String(limit) })}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            "The published inspection snapshot could not be loaded.",
          );
        const evidence = (await response.json()) as InspectionEvidence;
        if (evidence.ccn !== ccn)
          throw new Error(
            "The inspection response did not match this nursing home.",
          );
        if (!controller.signal.aborted) setState({ key, data: evidence });
      } catch (reason) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            key,
            data: previous.data?.ccn === ccn ? previous.data : undefined,
            error:
              reason instanceof Error
                ? reason.message
                : "The inspection snapshot could not be loaded.",
          }));
      }
    }
    void load();
    return () => controller.abort();
  }, [ccn, limit, key]);

  function showMore() {
    if (data)
      setRequest({ ccn, limit: Math.min(data.limit + 5, data.maximumLimit) });
  }

  const healthSource = data?.sources.find(
    (source) => source.datasetId === "r5ix-sfxw",
  );
  const penaltySource = data?.sources.find(
    (source) => source.datasetId === "g6vv-u9sr",
  );

  return (
    <section className="inspection-history" aria-labelledby={headingId}>
      <div className="section-title">
        <h3 id={headingId}>Inspection findings & penalties</h3>
        <span>CMS nursing-home evidence</span>
      </div>
      {loading && (
        <p className="small muted" role="status">
          {data
            ? "Loading more published records…"
            : "Loading the published inspection snapshot…"}
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="small">{error}</p>
          <button
            type="button"
            className="button button-outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="small muted">
            Published {dateLabel(healthSource?.released ?? null)} · Processed{" "}
            {dateLabel(healthSource?.modified ?? null)} · Retrieved{" "}
            {dateLabel(data.retrieved)}. This snapshot covers published
            inspection cycles and penalty reporting periods; individual event
            dates are shown below.
          </p>
          <div className="metrics-grid">
            <div>
              <span>Health citation records in snapshot</span>
              <strong>{data.healthCitations.total ?? "Not available"}</strong>
            </div>
            <div>
              <span>Fine events in snapshot</span>
              <strong>{data.penalties.fineCount ?? "Not available"}</strong>
            </div>
            <div>
              <span>Payment-denial events in snapshot</span>
              <strong>
                {data.penalties.paymentDenialCount ?? "Not available"}
              </strong>
            </div>
          </div>
          <h4>Latest health citation records</h4>
          {!data.healthCitations.available ? (
            <p className="small muted">
              Health citation detail is not available in this extract. Open the
              CMS source to check the record.
            </p>
          ) : data.healthCitations.total === 0 ? (
            <p className="small muted">
              No health citation rows were present for this CCN in this
              snapshot. This is not a finding that the home is free of problems.
            </p>
          ) : (
            <>
              <p className="small muted">
                Showing the latest {data.healthCitations.returned} of{" "}
                {data.healthCitations.total} citation records, newest first.
                Several findings can come from one inspection. Descriptions are
                CMS&apos;s brief descriptions, not full survey narratives.
              </p>
              <div className="source-list">
                {data.healthCitations.records.map((row) => {
                  const flags = [
                    row.standard === true ? "Standard inspection" : null,
                    row.complaint === true ? "Complaint-related" : null,
                    row.infectionControl === true
                      ? "Infection-control inspection"
                      : null,
                  ].filter(Boolean);
                  return (
                    <article className="source-item" key={row.id}>
                      <FileCheck2 size={20} aria-hidden="true" />
                      <div>
                        <strong>
                          <time dateTime={row.surveyDate ?? undefined}>
                            {dateLabel(row.surveyDate)}
                          </time>{" "}
                          · {row.tag}
                        </strong>
                        <p>{row.description}</p>
                        <span>
                          {flags.length
                            ? flags.join(" · ")
                            : "Inspection flags not specified"}{" "}
                          · CMS scope/severity:{" "}
                          {row.scopeSeverityCode ?? "Not published"}
                        </span>
                        <p className="small muted">
                          {row.scopeSeverityLabel ??
                            "Scope/severity meaning not available"}
                          {row.scopeSeverityLabel
                            ? " — as classified at this inspection."
                            : ""}
                        </p>
                        <p className="small muted">
                          {row.category}
                          {row.inspectionCycle
                            ? ` · Inspection cycle ${row.inspectionCycle}`
                            : ""}
                        </p>
                        {row.correctionStatus && (
                          <p className="small muted">
                            CMS correction status: {row.correctionStatus}
                            {row.correctionDate
                              ? ` · Correction date reported: ${dateLabel(row.correctionDate)}`
                              : ""}
                          </p>
                        )}
                        {(row.underIDR || row.underIIDR) && (
                          <p className="small muted">
                            CMS reports this citation under{" "}
                            {row.underIDR
                              ? "informal dispute resolution"
                              : "independent informal dispute resolution"}
                            .
                          </p>
                        )}
                        {row.surveyFootnote && (
                          <p className="small muted">
                            CMS survey footnote {row.surveyFootnote}; see the
                            source dictionary for its meaning.
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {data.healthCitations.hasMore &&
                data.limit < data.maximumLimit && (
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={showMore}
                    disabled={loading}
                  >
                    Show 5 more findings
                  </button>
                )}
              {data.healthCitations.hasMore &&
                data.limit >= data.maximumLimit && (
                  <p className="small muted">
                    This view is limited to the latest {data.maximumLimit}{" "}
                    records. Open the CMS Health Deficiencies dataset for the
                    full snapshot.
                  </p>
                )}
            </>
          )}
          <h4>Fines & payment denials</h4>
          {!data.penalties.available ? (
            <p className="small muted">
              Penalty detail is not available in this extract.
            </p>
          ) : data.penalties.total === 0 ? (
            <p className="small muted">
              No fine or payment-denial rows were present for this CCN in this
              snapshot.
            </p>
          ) : (
            <>
              <table className="comparison-table">
                <caption className="small muted">
                  Latest {data.penalties.returned} of {data.penalties.total}{" "}
                  published penalty events
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Penalty date</th>
                    <th scope="col">CMS event</th>
                    <th scope="col">Fine amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.penalties.records.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <time dateTime={row.date ?? undefined}>
                          {dateLabel(row.date)}
                        </time>
                      </td>
                      <td>
                        {row.type}
                        {row.type === "Payment Denial" && (
                          <p className="small muted">
                            Starts {dateLabel(row.paymentDenialStartDate)} ·{" "}
                            {row.paymentDenialLengthDays === null
                              ? "Duration not published"
                              : `${row.paymentDenialLengthDays} days`}
                          </p>
                        )}
                      </td>
                      <td>
                        {row.type === "Fine"
                          ? amountLabel(row.fineAmount)
                          : "Not a fine"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.penalties.hasMore && data.limit < data.maximumLimit && (
                <button
                  type="button"
                  className="button button-outline"
                  onClick={showMore}
                  disabled={loading}
                >
                  Show more penalty events
                </button>
              )}
              {data.penalties.hasMore && data.limit >= data.maximumLimit && (
                <p className="small muted">
                  Open CMS Penalties for events beyond this view&apos;s{" "}
                  {data.maximumLimit}-record limit.
                </p>
              )}
            </>
          )}
          <p className="small muted">
            A reported correction date does not independently verify current
            conditions. No listed penalties or citations is not a clearance or a
            complete assessment of care.
          </p>
          <div className="source-list">
            {[healthSource, penaltySource]
              .filter((source) => source !== undefined)
              .map((source) => (
                <a
                  className="source-item"
                  key={source.datasetId}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileCheck2 size={20} aria-hidden="true" />
                  <div>
                    <strong>CMS {source.title}</strong>
                    <p>Official dataset · CCN {data.ccn}</p>
                    <span>
                      Published {dateLabel(source.released)} · Data processed{" "}
                      {dateLabel(source.modified)}
                    </span>
                  </div>
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              ))}
          </div>
          <p className="small muted">
            <a
              className="text-link"
              href={data.careCompareUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open this nursing home in Care Compare{" "}
              <ExternalLink size={13} aria-hidden="true" />
            </a>{" "}
            ·{" "}
            <a
              className="text-link"
              href={data.dictionaryUrl}
              target="_blank"
              rel="noreferrer"
            >
              CMS data dictionary <ExternalLink size={13} aria-hidden="true" />
            </a>{" "}
            ·{" "}
            <a
              className="text-link"
              href={data.scopeSeverityGuideUrl}
              target="_blank"
              rel="noreferrer"
            >
              How CMS defines scope & severity{" "}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </p>
        </>
      )}
    </section>
  );
}
