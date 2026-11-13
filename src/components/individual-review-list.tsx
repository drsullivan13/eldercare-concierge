"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import {
  individualReviews,
  reviewAccountCounts,
  type IndividualReviewsResponse,
} from "@/lib/individual-reviews";
import type { LocationResearchResponse } from "@/lib/location-research-types";
import { evidenceDate } from "./evidence-date";
import { FamilyExperienceEvidence } from "./family-experience";
import { FacebookResearch } from "./facebook-research";

const source = {
  path: "/api/reviews",
  idParameter: "id",
  unavailable: "The individual review catalog could not be loaded.",
  mismatched: "The review catalog did not match this location.",
  fallback: "Individual reviews are unavailable.",
};
const PAGE_SIZE = 6;

export function IndividualReviewList({
  research,
  uid,
  targetId,
}: {
  research: LocationResearchResponse;
  uid: string;
  targetId?: string;
}) {
  const { data, loading, error, retry } =
    useProviderEvidence<IndividualReviewsResponse>(research.providerId, source);
  const [familyOnly, setFamilyOnly] = useState(false);
  const [page, setPage] = useState(0);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const requestedFocus = useRef(false);
  const accountRefs = useRef(new Map<string, HTMLElement>());
  const accounts = data?.accounts ?? individualReviews(research, null).accounts;
  const counts = reviewAccountCounts(accounts);
  const sourceReports = [
    ...(data?.sources ?? []).map((item) => ({
      publisher: item.publisher,
      count: item.reportedCount,
    })),
    ...research.reviewAggregates.map((item) => ({
      publisher: item.platform,
      count: item.count,
    })),
  ].filter(
    (item, index, reports) =>
      item.count !== null &&
      reports.findIndex(
        (other) =>
          other.publisher === item.publisher && other.count === item.count,
      ) === index,
  );
  const filtered = accounts
    .filter(
      (review) =>
        !familyOnly ||
        review.relationship === "family" ||
        review.relationship === "resident",
    )
    .toSorted(
      (a, b) =>
        Number(b.aspects.some(({ sentiment }) => sentiment !== "positive")) -
          Number(a.aspects.some(({ sentiment }) => sentiment !== "positive")) ||
        (b.date ?? "").localeCompare(a.date ?? "") ||
        a.id.localeCompare(b.id),
    );
  const targetIndex = targetId
    ? filtered.findIndex((review) => `${uid}-account-${review.id}` === targetId)
    : -1;
  const [followTarget, setFollowTarget] = useState(true);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage =
    followTarget && targetIndex >= 0
      ? Math.floor(targetIndex / PAGE_SIZE)
      : Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    if (requestedFocus.current) {
      requestedFocus.current = false;
      listHeading.current?.focus({ preventScroll: true });
      listHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [currentPage, familyOnly]);

  useEffect(() => {
    if (!targetId || !followTarget) return;
    const target = accountRefs.current.get(targetId);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
  }, [targetId, currentPage, followTarget, data]);

  function changePage(next: number) {
    requestedFocus.current = true;
    setFollowTarget(false);
    setPage(next);
  }

  return (
    <section aria-labelledby={`${uid}-reviews`}>
      <div className="review-section-title">
        <h3 id={`${uid}-title`}>What people say</h3>
      </div>
      <div className="review-count-clarity">
        <p>
          <strong>
            {counts.withText > 0
              ? `${counts.withText} reviews here`
              : counts.total > 0
                ? `${counts.total} review links here`
                : "No individual accounts here"}
            {counts.withText > 0 && counts.total > counts.withText
              ? ` + ${counts.total - counts.withText} links`
              : ""}
          </strong>
          {" · "}
          {research.experience.reviewCount > 0
            ? `${research.experience.reviewCount} source ratings used`
            : sourceReports.length === 1
              ? `${sourceReports[0].count} source ratings reported`
              : "Source rating totals below"}
        </p>
      </div>
      {data?.sources.map((item) =>
        item.scopeNote ? (
          <p className="review-source-scope" key={item.id}>
            <strong>{item.publisher} rating scope.</strong> {item.scopeNote}
          </p>
        ) : null,
      )}
      {loading && (
        <p role="status">Checking for additional individual records…</p>
      )}
      {error && (
        <div role="alert" className="review-catalog-error">
          <p>{error} Showing retained location accounts only.</p>
          <button className="button button-outline" onClick={retry}>
            Retry individual reviews
          </button>
        </div>
      )}
      <label className="review-filter">
        <input
          type="checkbox"
          checked={familyOnly}
          onChange={(event) => {
            requestedFocus.current = true;
            setFollowTarget(false);
            setFamilyOnly(event.target.checked);
            setPage(0);
          }}
        />
        Family & resident accounts
      </label>
      <h4
        id={`${uid}-reviews`}
        className={`review-page-heading${pages === 1 && filtered.length > 0 ? " review-page-heading-hidden" : ""}`}
        tabIndex={-1}
        ref={listHeading}
      >
        {filtered.length
          ? `Accounts ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`
          : "No individual accounts to show"}
      </h4>
      {!filtered.length && (
        <p className="research-empty">
          No excerpts to show{familyOnly ? " for this filter" : " yet"}. Missing
          excerpts do not mean no reviews exist. Use the original review-page
          links below.
        </p>
      )}
      <div
        className="public-reviews"
        role="list"
        aria-labelledby={`${uid}-reviews`}
      >
        {visible.map((review) => {
          const hasConcerns = review.aspects.some(
            ({ sentiment }) => sentiment !== "positive",
          );
          const id = `${uid}-account-${review.id}`;
          return (
            <article
              id={id}
              key={review.id}
              role="listitem"
              tabIndex={-1}
              ref={(element) => {
                if (element) accountRefs.current.set(id, element);
                else accountRefs.current.delete(id);
              }}
            >
              {review.excerpt ? (
                <blockquote>“{review.excerpt}”</blockquote>
              ) : review.summary ? (
                <p className="review-summary">
                  <strong>Research summary</strong> · {review.summary}
                </p>
              ) : (
                <p className="review-link-only">
                  <strong>Individual review on {review.publisher}</strong>
                  <span>
                    Text is not republished here. Open the source to read this
                    record. The source may require access or remove a review.
                  </span>
                </p>
              )}
              <div className="review-meta">
                <strong>
                  {review.publisher}
                  {review.providerSelected &&
                    " · Provider-selected testimonial"}
                </strong>
                <span>
                  {review.relationship === "unknown"
                    ? "Relationship not established"
                    : `Self-described ${review.relationship}`}
                </span>
                <span>
                  {evidenceDate(review.date)}
                  {review.rating !== null
                    ? ` · ${review.rating}/${review.scale}`
                    : ""}
                </span>
              </div>
              {hasConcerns && (
                <p className="review-concern">
                  {review.summary || "This account also raises concerns."}
                </p>
              )}
              {(review.notes.length > 0 ||
                review.aspects.length > 0 ||
                review.searchResultOnly ||
                Boolean(review.excerpt && review.summary)) && (
                <details className="evidence-disclosure">
                  <summary>Account context</summary>
                  <div className="review-aspects">
                    {review.aspects.map((aspect, index) => (
                      <span
                        key={index}
                        className={`sentiment-${aspect.sentiment}`}
                      >
                        {aspect.aspect} · {aspect.sentiment}
                      </span>
                    ))}
                  </div>
                  {review.excerpt && review.summary && !hasConcerns && (
                    <p>
                      <strong>Research summary</strong> · {review.summary}
                    </p>
                  )}
                  {review.notes.length > 0 && (
                    <ul className="research-specifics">
                      {review.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  )}
                  {review.searchResultOnly && (
                    <p>Search result only. The full page was not reviewed.</p>
                  )}
                </details>
              )}
              <a
                className="research-source"
                href={review.url}
                target="_blank"
                rel="noreferrer"
              >
                Read the original account on {review.publisher}
                <ExternalLink size={14} />
              </a>
            </article>
          );
        })}
      </div>
      {pages > 1 && (
        <nav className="review-pagination" aria-label="Individual review pages">
          <button
            className="button button-outline"
            disabled={currentPage === 0}
            onClick={() => changePage(currentPage - 1)}
          >
            Previous accounts
          </button>
          <span role="status">
            Page {currentPage + 1} of {pages}
          </span>
          <button
            className="button button-outline"
            disabled={currentPage === pages - 1}
            onClick={() => changePage(currentPage + 1)}
          >
            Next accounts
          </button>
        </nav>
      )}
      <details className="evidence-disclosure review-sampling">
        <summary>How these accounts were selected</summary>
        {research.checkedAt && (
          <p>Research checked {evidenceDate(research.checkedAt)}.</p>
        )}
        <h5>Selection & limits</h5>
        <ul className="research-specifics">
          <li>
            These are the individual records Harbor has retained or linked, not
            every rating included in a platform average. An unknown relationship
            does not establish firsthand experience. No author identity is
            inferred.
          </li>
          <li>
            {counts.total} individual accounts available, {counts.withText} with
            retained text or a research summary. Source counts are platform
            totals, not reviews reproduced here. They may overlap and some
            sources are excluded from the score.
          </li>
          <li>
            Selected accounts, not a representative survey. Relationships are
            self-described, not independently verified. Concerns appear first,
            then the most recent dates. Unknown dates stay unknown.
          </li>
        </ul>
        {sourceReports.length > 0 && (
          <>
            <h5>Platform rating totals</h5>
            <ul className="research-specifics">
              {sourceReports.map((item) => (
                <li key={`${item.publisher}-${item.count}`}>
                  {item.publisher} reports {item.count} ratings.
                </li>
              ))}
            </ul>
          </>
        )}
        {data?.sources.map((item) => (
          <section className="review-retained-source" key={item.id}>
            <h5>{item.publisher}</h5>
            <dl className="research-values">
              <div>
                <dt>Source population</dt>
                <dd>
                  {item.reportedCount === null
                    ? "Rating count not established"
                    : `${item.reportedCount} ratings reported`}
                </dd>
              </div>
              <div>
                <dt>Retained accounts</dt>
                <dd>{item.retainedCount} individual records retained.</dd>
              </div>
            </dl>
            <ul className="research-specifics">
              <li>{item.stopReason}</li>
              {item.scopeNote && <li>{item.scopeNote}</li>}
            </ul>
            <a
              className="research-source"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              Individual account source on {item.publisher}{" "}
              <ExternalLink size={14} />
            </a>
          </section>
        ))}
        {Boolean(data?.notes.length) && (
          <>
            <h5>Research notes</h5>
            <ul className="research-specifics">
              {data!.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </>
        )}
        <FamilyExperienceEvidence evidence={research.familyExperience} />
      </details>
      <FacebookResearch
        key={research.providerId}
        research={research.facebookResearch}
      />
    </section>
  );
}
