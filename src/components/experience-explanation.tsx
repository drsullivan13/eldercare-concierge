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
  const weighted = score.includedSources.reduce(
    (sum, source) => sum + source.normalizedRating * source.weight,
    0,
  );
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
        Published prices, rooms and perks do not add points. This is not a
        clinical-quality or safety score.
      </p>
      <p className="score-publication-reason">{score.reason}</p>
      <details className="evidence-disclosure experience-method">
        <summary>How to read this score</summary>
        <p>
          Convert each eligible source average to ten points by dividing its
          rating by its scale and multiplying by 10. Give each source a raw
          weight equal to the square root of its review count, capped at 100
          reviews. Divide each raw weight by the total raw weight. Add the
          weighted ten-point averages and round to one decimal.
        </p>
        {score.includedSources.length > 0 && (
          <>
            <ul className="score-source-weights">
              {score.includedSources.map((item) => (
                <li key={item.sourceId}>
                  <strong>{item.platform}</strong>
                  <span>
                    {item.rating}/{item.scale} becomes{" "}
                    {item.normalizedRating.toFixed(2)}/10. {item.count} reported
                    ratings give a raw weight of √{Math.min(item.count, 100)} ={" "}
                    {Math.sqrt(Math.min(item.count, 100)).toFixed(4)}.
                  </span>
                  <span>
                    {(item.weight * 100).toFixed(2)}% of the calculation.{" "}
                    {item.normalizedRating.toFixed(2)} ×{" "}
                    {item.weight.toFixed(6)} ={" "}
                    {(item.normalizedRating * item.weight).toFixed(4)} points.
                  </span>
                </li>
              ))}
            </ul>
            <p>
              Weighted result before rounding is {weighted.toFixed(4)}/10.{" "}
              {score.value === null
                ? "This is not a published Harbor score because the publication requirements are not met."
                : `Rounded Harbor score is ${score.value.toFixed(1)}/10.`}{" "}
              Displayed weights are rounded; the calculation uses full
              precision.
            </p>
          </>
        )}
        <p>
          Publish only with 30 reported ratings from one source family, or at
          least 10 across two families with five each. Shared or syndicated
          sources contribute once. Checks must be within 180 days and aggregate
          snapshots within 365 days.
        </p>
        <p>
          Withhold when two source families with at least ten ratings each
          differ by two or more points out of ten, or when eligible recent
          accounts trigger the disagreement rules. Two independent families with
          opposing accounts can withhold a score. So can at least three contrary
          accounts that form a majority of the recent eligible accounts in a
          reviewed visible sample. A recent account must be within 730 days.
        </p>
        <p>
          Moderate coverage requires at least 30 ratings and two source families
          with ten each, without substantial disagreement. Otherwise a published
          score has limited coverage. Missing or excluded evidence is not a
          negative rating.
        </p>
        <p>
          Reviewers are not independently authenticated. Tour reviews may be
          included, and counts can overlap across sites. Selected accounts and
          Facebook findings never add numeric points or ratings to the total.
          Read the inspection evidence too.
        </p>
        <Link
          href="/methodology#experience"
          target="_blank"
          className="text-link"
        >
          How this score works <ExternalLink size={14} />
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
          const included = score.includedSources.find(
            (item) => item.sourceId === aggregate.sourceId,
          );
          return (
            <article key={`${aggregate.sourceId}-${index}`}>
              <strong>{aggregate.platform}</strong>
              <span>
                {aggregate.rating === null
                  ? "Rating not established"
                  : `${aggregate.rating} / ${aggregate.scale}`}
                {" · "}
                {aggregate.count === null
                  ? "Count unknown"
                  : `${aggregate.count} ratings reported by this source`}
              </span>
              <p>
                {aggregate.scope} · Rating as of {evidenceDate(aggregate.asOf)}
              </p>
              {included && (
                <p className="review-included">
                  Eligible source · {(included.weight * 100).toFixed(2)}% of the
                  weighted calculation
                  {score.value === null ? ", not a published score" : ""}.
                </p>
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
              {aggregate.notes.length > 0 && (
                <details className="evidence-disclosure">
                  <summary>Source context</summary>
                  {aggregate.notes.map((note, noteIndex) => (
                    <p key={noteIndex}>{note}</p>
                  ))}
                </details>
              )}
              {score.excludedSources
                .filter((item) => item.sourceId === aggregate.sourceId)
                .map((item, excludedIndex) => (
                  <p className="review-excluded" key={excludedIndex}>
                    Excluded from index: {item.reason}
                  </p>
                ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}
