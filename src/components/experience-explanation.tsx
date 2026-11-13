import { ExternalLink, MessageSquare } from "lucide-react";
import Link from "next/link";
import type { LocationResearchResponse } from "@/lib/location-research-types";
import { evidenceDate } from "./evidence-date";

export function ExperienceExplanation({
  data,
  uid,
}: {
  data: LocationResearchResponse;
  uid: string;
}) {
  const score = data.experience;
  return (
    <section
      className="review-score-explanation"
      aria-labelledby={`${uid}-ratings`}
    >
      <h4 id={`${uid}-ratings`}>Review ratings & source coverage</h4>
      <div className="experience-overview">
        <div className="experience-number">
          {score.value === null ? (
            <MessageSquare size={28} />
          ) : (
            <>
              {score.value.toFixed(1)}
              <small>/10</small>
            </>
          )}
        </div>
        <div>
          <h4>{score.label}</h4>
          <p>
            {score.publicationStatus === "sources-disagree"
              ? "Harbor score withheld · Sources disagree"
              : score.value === null
                ? "Not rated yet"
                : `${score.confidence === "moderate" ? "Moderate" : "Limited"} evidence`}
          </p>
          <p>
            {score.reviewCount} source-reported ratings ·{" "}
            {score.independentSourceCount} source{" "}
            {score.independentSourceCount === 1 ? "family" : "families"}
          </p>
        </div>
      </div>
      {score.publicationStatus === "single-source-estimate" && (
        <p>Single-source estimate · {score.singleSourceLabel}</p>
      )}
      {score.selectedConcerns && (
        <p className="review-concern">Selected reviews include concerns.</p>
      )}
      <p className="score-purpose">
        <strong>
          Ratings measure reported consumer experience, not the amenities.
        </strong>{" "}
        This is not a clinical-quality or safety score. Read the original
        ratings alongside inspection evidence and your own follow-up.
      </p>
      <details className="evidence-disclosure experience-method">
        <summary>How to read this score</summary>
        <h5>What the score cannot establish</h5>
        <p>
          Reviewers are not independently authenticated. Tour reviews may be
          included, and counts can overlap across sites. A recent source check
          does not mean the care experiences are recent. Missing evidence is not
          a negative rating. Selected accounts are not representative of every
          resident or family. Read the inspection evidence too.
        </p>
        <Link
          href="/methodology#experience"
          target="_blank"
          className="text-link"
        >
          Review sources and limitations <ExternalLink size={14} />
        </Link>
      </details>
      {Boolean(data.reviewLinks?.length) && (
        <div className="search-research-links">
          {data.reviewLinks!.map((link) => (
            <a
              className="research-source"
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              Read independent reviews on {link.publisher}{" "}
              <ExternalLink size={14} />
            </a>
          ))}
        </div>
      )}
      <h4>What each source reports</h4>
      {!data.reviewAggregates.length && (
        <p className="research-empty">
          No location-matched ratings have been researched yet.
        </p>
      )}
      <div className="review-platforms">
        {data.reviewAggregates.map((aggregate, index) => {
          const source = data.sources.find(
            (item) => item.id === aggregate.sourceId,
          );
          return (
            <article key={`${aggregate.sourceId}-${index}`}>
              <h5>{aggregate.platform}</h5>
              <dl className="research-values">
                <div>
                  <dt>Published rating</dt>
                  <dd>
                    {aggregate.rating === null
                      ? "Rating not established"
                      : `${aggregate.rating} / ${aggregate.scale}`}
                  </dd>
                </div>
                <div>
                  <dt>Source population</dt>
                  <dd>
                    {aggregate.count === null
                      ? "Count unknown"
                      : `${aggregate.count} ratings reported by this source`}
                  </dd>
                </div>
                <div>
                  <dt>Rating scope</dt>
                  <dd>{aggregate.scope}</dd>
                </div>
                <div>
                  <dt>Rating as of</dt>
                  <dd>{evidenceDate(aggregate.asOf)}</dd>
                </div>
              </dl>
              {aggregate.notes.length > 0 && (
                <details className="evidence-disclosure">
                  <summary>Source context</summary>
                  <ul className="research-specifics">
                    {aggregate.notes.map((note, noteIndex) => (
                      <li key={noteIndex}>{note}</li>
                    ))}
                  </ul>
                </details>
              )}
              {source && (
                <a
                  className="research-source"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Read reviews on {aggregate.platform} · checked{" "}
                  {evidenceDate(source.checkedAt)}
                  {source.access === "search-result"
                    ? " · search result only"
                    : ""}
                  <ExternalLink size={14} />
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
