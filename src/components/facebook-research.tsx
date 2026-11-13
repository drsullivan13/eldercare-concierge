"use client";

import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import type {
  FacebookFindingKind,
  FacebookResearch as Research,
} from "@/lib/facebook-research";
import "./facebook-research.css";

const KINDS: Record<FacebookFindingKind, string> = {
  "resident-family": "Resident or family account",
  recommendation: "Recommendation",
  tour: "Tour account",
  "provider-promotion": "Provider promotion",
  employment: "Employment or recruitment",
};
const STATUSES = {
  "findings-available": "Findings available",
  "no-relevant-result": "No relevant result in this search",
  withheld: "Collected material withheld",
  partial: "Partial coverage",
};

function date(value: string | null) {
  if (!value) return "Date not provided";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

function facebookUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "facebook.com" ||
        url.hostname.endsWith(".facebook.com") ||
        url.hostname === "fb.watch")
    )
      return url.href;
  } catch {
    /* Invalid links are not made clickable. */
  }
  return undefined;
}

export function FacebookResearch({ research }: { research?: Research }) {
  const uid = useId();
  const [kind, setKind] = useState<FacebookFindingKind | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const findings =
    research?.findings.filter((f) => kind === "all" || f.kind === kind) ?? [];
  const visible = expanded ? findings : findings.slice(0, 3);

  return (
    <section className="fb-research" aria-labelledby={`${uid}-title`}>
      <div className="fb-research-heading">
        <h4 id={`${uid}-title`}>Facebook findings</h4>
        <span className="fb-research-status">
          {research ? STATUSES[research.status] : "Not searched in this pilot"}
        </span>
      </div>
      {!research ? (
        <details className="fb-research-coverage">
          <summary>What this Facebook search covered</summary>
          <p>
            This location was not included in the Facebook search pilot. That
            does not mean no relevant posts exist.
          </p>
        </details>
      ) : (
        <>
          {research.findings.length > 0 && (
            <p className="fb-research-intro">
              Selected public posts about this location. Resident and family
              accounts are labeled separately from recommendations and provider
              promotion.
            </p>
          )}
          <details className="fb-research-coverage">
            <summary>What this Facebook search covered</summary>
            <p>{research.coverageExplanation}</p>
            <p className="fb-research-caution">
              Qualitative context only. A post adds no stars or points. Selected
              posts are not a representative survey. Relationships are
              self-described.
            </p>
            <p className="fb-research-dates">
              Search: {date(research.searchedAt)} · Editorial review:{" "}
              {date(research.checkedAt)}
            </p>
            <p className="fb-research-basis">{research.reviewBasis}</p>
            <p className="fb-research-counts">
              {research.foundCount} captured observations ·{" "}
              {research.publishedObservationCount} published ·{" "}
              {research.withheldCount} withheld. Observations are collected
              rows, not a count of people; several can be grouped into one
              finding.
            </p>
            <p className="fb-research-source-note">
              Links point to the attributed Facebook source. Facebook may
              require sign-in, and a post may have changed or been removed since
              collection.
            </p>
          </details>
          {research.findings.length > 0 ? (
            <>
              <div className="fb-research-controls">
                <label htmlFor={`${uid}-kind`}>Facebook finding type</label>
                <select
                  id={`${uid}-kind`}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as FacebookFindingKind | "all");
                    setExpanded(false);
                  }}
                >
                  <option value="all">All finding types</option>
                  {Object.entries(KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="fb-research-result-count" role="status">
                Showing {visible.length} of {findings.length} findings
                {kind === "all" ? "" : " of this type"}.
              </p>
              <div className="fb-research-findings" id={`${uid}-findings`}>
                {visible.map((finding) => {
                  const source = facebookUrl(finding.sourceUrl);
                  const thread = facebookUrl(finding.threadUrl);
                  const additionalSources = [
                    ...new Set(
                      finding.sourceUrls
                        ?.map(facebookUrl)
                        .filter((value): value is string => Boolean(value)) ??
                        [],
                    ),
                  ].filter((value) => value !== source && value !== thread);
                  return (
                    <article key={finding.id} className="fb-research-finding">
                      <div className="fb-research-finding-meta">
                        <strong>{KINDS[finding.kind]}</strong>
                        <span>Post date: {date(finding.date)}</span>
                      </div>
                      <p className="fb-research-relationship">
                        Self-described relationship:{" "}
                        {finding.relationship &&
                        finding.relationship !== "unknown"
                          ? finding.relationship.replace(/[-_]/g, " ")
                          : "not established"}
                      </p>
                      <p>
                        <strong>Research summary</strong> · {finding.summary}
                      </p>
                      {finding.excerpt && (
                        <blockquote>“{finding.excerpt}”</blockquote>
                      )}
                      {finding.topics.length > 0 && (
                        <ul className="fb-research-topics" aria-label="Topics">
                          {finding.topics.map((topic) => (
                            <li key={topic}>{topic.replaceAll("_", " ")}</li>
                          ))}
                        </ul>
                      )}
                      {finding.limitations.length > 0 && (
                        <details className="fb-research-context">
                          <summary>Context and limits</summary>
                          <ul className="fb-research-limits">
                            {finding.limitations.map((limit, i) => (
                              <li key={i}>{limit}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="fb-research-links">
                        {source ? (
                          <a
                            href={source}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Facebook source{" "}
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : (
                          <span>Source link unavailable</span>
                        )}
                        {thread && thread !== source && (
                          <a
                            href={thread}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Discussion thread{" "}
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        )}
                      </div>
                      <details className="fb-research-provenance">
                        <summary>Source provenance</summary>
                        <p>
                          {finding.sourceObservationIds.length} collected{" "}
                          {finding.sourceObservationIds.length === 1
                            ? "observation"
                            : "observations"}
                          . Collected rows, not independent people or
                          households.
                        </p>
                        <p>Editorial review: {date(research.checkedAt)}</p>
                        <ul aria-label="Source observation IDs">
                          {finding.sourceObservationIds.map((observationId) => (
                            <li key={observationId}>
                              <code>{observationId}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                      {additionalSources.length > 0 && (
                        <details className="fb-research-additional">
                          <summary>
                            Additional Facebook sources (
                            {additionalSources.length})
                          </summary>
                          <ul>
                            {additionalSources.map((url, i) => (
                              <li key={url}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Grouped source {i + 1}{" "}
                                  <ExternalLink size={13} aria-hidden="true" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
              {findings.length === 0 && (
                <p>
                  No published findings match this type. Other types may include
                  promotions or employment posts.
                </p>
              )}
              {findings.length > 3 && (
                <button
                  type="button"
                  className="fb-research-toggle"
                  aria-expanded={expanded}
                  aria-controls={`${uid}-findings`}
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded
                    ? "Show fewer Facebook findings"
                    : `Show all ${findings.length} Facebook findings`}
                </button>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
