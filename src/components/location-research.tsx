"use client";
import { useEffect, useRef, useState } from "react";
import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import {
  CalendarClock,
  Check,
  ExternalLink,
  MessageSquare,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { evidenceDate as date } from "./evidence-date";
import { PropertyOverview } from "./property-overview";
import { FacebookResearch } from "./facebook-research";
import { FamilyExperienceEvidence } from "./family-experience";
import type {
  LocationResearchResponse,
  OfferingFact,
  ResearchSource,
} from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import type { NavigateProfile, ProfileNavigation } from "./profile-pane";
import "./location-research.css";

const COST_LABELS = {
  "base-rent": "Base rent",
  "care-fee": "Care fee",
  "entrance-fee": "Entrance fee",
  other: "Published charge",
};

function normalized(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function price(fact: OfferingFact) {
  if (!fact.amount) return null;
  const { min, max, period } = fact.amount;
  const format = (v: number) =>
    v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  return `${format(min)}${max === null ? "" : `–${format(max)}`} ${period === "one-time" ? "one-time" : `/ ${period}`}`;
}
function SourceLink({
  source,
  label,
}: {
  source?: ResearchSource;
  label?: string;
}) {
  if (!source) return null;
  return (
    <a
      className="research-source"
      href={source.url}
      target="_blank"
      rel="noreferrer"
    >
      {label ?? source.publisher} · checked {date(source.checkedAt)}
      {source.access === "search-result" ? " · search result only" : ""}
      <ExternalLink size={12} />
    </a>
  );
}
function Facts({
  facts,
  sources,
  empty,
  uid,
  targetId,
  targetRef,
}: {
  facts: OfferingFact[];
  sources: ResearchSource[];
  empty: string;
  uid?: string;
  targetId?: string;
  targetRef?: React.RefObject<HTMLElement | null>;
}) {
  if (!facts.length)
    return empty ? <p className="research-empty">{empty}</p> : null;
  const items = facts.map((fact) => (
    <article
      key={fact.id}
      id={uid ? `${uid}-price-${fact.id}` : undefined}
      ref={
        uid && targetId === `${uid}-price-${fact.id}` ? targetRef : undefined
      }
      tabIndex={-1}
      className={`offering-fact fact-${fact.kind}`}
    >
      {fact.amount && (
        <span className="cost-label">
          {COST_LABELS[fact.amount.type]} ·{" "}
          {fact.amount.period === "one-time"
            ? "One-time"
            : `Per ${fact.amount.period}`}
        </span>
      )}
      {fact.amount && !/\$\s*\d/.test(fact.text) && (
        <strong className="offering-price">{price(fact)}</strong>
      )}
      <p>{fact.text}</p>
      {(fact.asOf || fact.amount?.asOf) && (
        <span className="small muted">
          Source effective date: {date(fact.asOf || fact.amount?.asOf)}
        </span>
      )}
      <SourceLink
        source={sources.find((source) => source.id === fact.sourceId)}
      />
    </article>
  ));
  const limit = facts.length > 3 ? 2 : facts.length;
  return (
    <>
      <div className="offering-facts">{items.slice(0, limit)}</div>
      {items.length > limit && (
        <details
          className="offering-more"
          open={
            facts
              .slice(limit)
              .some((fact) => targetId === `${uid}-price-${fact.id}`) ||
            undefined
          }
        >
          <summary>
            Show {items.length - limit} more{" "}
            {facts[0].kind === "cost" ? "price entries" : "details"}
          </summary>
          <div className="offering-facts">{items.slice(limit)}</div>
        </details>
      )}
    </>
  );
}

const source = {
  path: "/api/research",
  idParameter: "id",
  unavailable: "The location research could not be loaded.",
  mismatched: "The research did not match this location.",
  fallback: "Research is unavailable.",
};

export function LocationResearch({
  provider,
  onTask,
  navigation,
  onNavigate,
  uid,
}: {
  provider: Provider;
  onTask: (title: string) => boolean;
  navigation: ProfileNavigation;
  onNavigate: NavigateProfile;
  uid: string;
}) {
  const { id: providerId, name: providerName } = provider;
  const { pane, targetId } = navigation;
  const targetRef = useRef<HTMLElement>(null);
  const [taskAdded, setTaskAdded] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  const { data, error, loading, retry } =
    useProviderEvidence<LocationResearchResponse>(providerId, source);
  useEffect(() => {
    if (!targetId || !data) return;
    targetRef.current?.focus({ preventScroll: true });
    targetRef.current?.scrollIntoView({ block: "start" });
  }, [navigation, targetId, data]);
  const facts = (kinds: OfferingFact["kind"][]) =>
    data?.facts.filter((f) => kinds.includes(f.kind)) ?? [];
  const availabilitySource = data?.sources.find(
    (s) => s.id === data.availability.sourceId,
  );
  const reviews =
    data?.reviews
      .filter(
        (r) =>
          !familyOnly ||
          targetId === `${uid}-account-${r.id}` ||
          r.relationship === "family" ||
          r.relationship === "resident",
      )
      .toSorted(
        (a, b) =>
          Number(b.aspects.some(({ sentiment }) => sentiment !== "positive")) -
            Number(
              a.aspects.some(({ sentiment }) => sentiment !== "positive"),
            ) || (b.date ?? "").localeCompare(a.date ?? ""),
      ) ?? [];
  const careFacts = facts(["care", "amenity", "activity", "dining"]);
  const catalogServices = provider.services.filter(
    (service) =>
      !careFacts.some((fact) =>
        ` ${normalized(fact.text)} `.includes(` ${normalized(service)} `),
      ),
  );
  const availabilityFacts = facts(["availability"]).filter(
    (fact) =>
      normalized(fact.text) !== normalized(data?.availability.text ?? ""),
  );
  const inventoryDetails = availabilityFacts.filter(
    (fact) =>
      data?.availability.status === "opening-published" &&
      fact.sourceId === data.availability.sourceId &&
      fact.numericValue != null,
  );

  return (
    <section
      className="location-research"
      aria-label={pane === "overview" ? "Overview" : undefined}
      aria-labelledby={pane === "overview" ? undefined : `${uid}-title`}
    >
      {pane !== "overview" && (
        <div className="section-title">
          <h3 id={`${uid}-title`}>
            {pane === "costs"
              ? "Make yourself at home"
              : pane === "reviews"
                ? "Resident & family experiences"
                : "Availability & services"}
          </h3>
          {data?.checkedAt && (
            <span>Research checked {date(data.checkedAt)}</span>
          )}
        </div>
      )}
      {loading && (
        <p role="status" className="small muted">
          Loading offerings, availability and review evidence…
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="button button-outline" onClick={retry}>
            Retry location research
          </button>
        </div>
      )}
      {data?.admissionRestriction && (
        <div className="research-caution">
          <strong>Admission eligibility needs checking</strong>
          <p>{data.admissionRestriction.text}</p>
          <SourceLink
            source={data.sources.find(
              (source) => source.id === data.admissionRestriction?.sourceId,
            )}
          />
        </div>
      )}
      {data && pane === "overview" && (
        <PropertyOverview
          data={data}
          provider={provider}
          uid={uid}
          reviews={reviews}
          onNavigate={onNavigate}
        />
      )}
      {pane === "details" && catalogServices.length > 0 && (
        <div className="catalog-services">
          <h4>Listed services and care settings</h4>
          <p className="research-intro">
            Catalog-listed services. Confirm the care level and what is
            included.
          </p>
          <ul>
            {catalogServices.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
          {provider.sources.map((source, i) => (
            <a
              className="research-source"
              href={source.url}
              target="_blank"
              rel="noreferrer"
              key={`${source.url}-${i}`}
            >
              {source.publisher} · checked {date(source.checkedAt)}
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
      {data && (
        <>
          <div className="research-panel">
            {pane === "costs" && (
              <>
                <section aria-labelledby={`${uid}-costs`}>
                  <h4 id={`${uid}-costs`}>
                    Published costs & what they include
                  </h4>
                  <p className="research-intro">
                    Published prices are not a personal quote. Check the dates
                    and what is included.
                  </p>
                  <Facts
                    facts={facts(["cost"])}
                    sources={data.sources}
                    uid={uid}
                    targetId={targetId}
                    targetRef={targetRef}
                    empty="Pricing has not been established for this location. Request an itemized quote for the room and care needed."
                  />
                  {facts(["cost"]).length > 0 &&
                    !facts(["cost"]).some(
                      (fact) =>
                        fact.amount &&
                        fact.amount.min > 0 &&
                        fact.amount.period !== "one-time",
                    ) && (
                      <p className="research-empty">
                        No numeric ongoing care rate is established here.
                        Request an itemized quote for your care needs.
                      </p>
                    )}
                  <div className="research-question">
                    <strong>Ask for the complete bill</strong>
                    <p>
                      {provider.locationKind === "office"
                        ? "Hourly or visit rates, minimum shifts, overnight or live-in charges, nursing fees, cancellation terms and what insurance covers."
                        : "Room or rent, assessed care, medication support, second-person fees, deposits, annual increases, refund terms and any minimum stay."}
                    </p>
                  </div>
                </section>
                <section aria-labelledby={`${uid}-life`}>
                  <h4 id={`${uid}-life`}>Care, amenities & everyday life</h4>
                  <p className="research-intro">
                    Ask which services are included in your care level and
                    contract.
                  </p>
                  <Facts
                    facts={facts(["care", "amenity", "activity", "dining"])}
                    sources={data.sources}
                    empty="Amenities and activities have not been researched yet. Ask the provider what is available."
                  />
                </section>
                <section aria-labelledby={`${uid}-rooms`}>
                  <h4 id={`${uid}-rooms`}>
                    {provider.locationKind === "office"
                      ? "How care is delivered"
                      : "Room types & living arrangements"}
                  </h4>
                  <Facts
                    facts={facts(["room"])}
                    sources={data.sources}
                    empty={
                      provider.locationKind === "office"
                        ? "Care is arranged through an office, not a residential room. Confirm visits, shifts and service at your address."
                        : "Room layouts have not been researched yet. Ask for current floor plans and sharing arrangements."
                    }
                  />
                </section>
              </>
            )}
            {pane === "details" && (
              <section aria-label="Availability">
                <div
                  className={`availability-observation availability-${data.availability.status}`}
                >
                  <CalendarClock size={23} />
                  <div>
                    <h4>
                      {data.availability.status === "opening-published"
                        ? "The provider publishes an opening claim"
                        : data.availability.status === "waitlist-published"
                          ? "A waitlist is published"
                          : data.availability.status === "inquiry-only"
                            ? "Availability requires an inquiry"
                            : "Current availability is not established"}
                    </h4>
                    <p>{data.availability.text}</p>
                    <SourceLink source={availabilitySource} />
                  </div>
                </div>
                {data.availability.status === "opening-published" && (
                  <p className="research-caution">
                    This is a dated observation of a public page, not a
                    reservation or a confirmed opening today. An undated page
                    can be stale even when checked recently.
                  </p>
                )}
                {data.availability.asOf && (
                  <p className="small muted">
                    Source availability date: {date(data.availability.asOf)}
                  </p>
                )}
                {availabilityFacts.length > 0 && (
                  <Facts
                    facts={availabilityFacts.filter(
                      (fact) => !inventoryDetails.includes(fact),
                    )}
                    sources={data.sources}
                    empty=""
                  />
                )}
                {inventoryDetails.length > 0 && (
                  <details className="evidence-disclosure">
                    <summary>Published inventory breakdown</summary>
                    <Facts
                      facts={inventoryDetails}
                      sources={data.sources}
                      empty=""
                    />
                  </details>
                )}
                <div className="research-question">
                  <strong>Confirm the opening that fits</strong>
                  <p>
                    {provider.locationKind === "office"
                      ? "Service at your address, care needs, staff availability, start date, minimum shifts and assessment requirements."
                      : "Care level, room type, move-in window, assessment requirements, waitlist position, refundable deposit and how long a room can be held."}
                  </p>
                  <button
                    className="button button-outline"
                    disabled={taskAdded}
                    onClick={() =>
                      setTaskAdded(
                        onTask(
                          `Ask ${providerName} for ${provider.locationKind === "office" ? "staff availability, start dates" : "room availability, waitlist timing"} and an itemized quote`.slice(
                            0,
                            200,
                          ),
                        ),
                      )
                    }
                  >
                    {taskAdded ? <Check size={15} /> : <Plus size={15} />}
                    {taskAdded
                      ? "Added to your plan"
                      : "Add an availability check"}
                  </button>
                </div>
              </section>
            )}
            {pane === "reviews" && (
              <>
                <section aria-labelledby={`${uid}-reviews`}>
                  <div className="review-section-title">
                    <h4 id={`${uid}-reviews`}>Selected public experiences</h4>
                    <label>
                      <input
                        type="checkbox"
                        checked={familyOnly}
                        onChange={(e) => setFamilyOnly(e.target.checked)}
                      />{" "}
                      Family & resident accounts
                    </label>
                  </div>
                  <p className="research-intro">
                    Selected accounts, not a representative survey.
                    Relationships are self-described, not verified. Accounts
                    with negative or mixed aspects appear first, including when
                    the excerpt itself is positive.
                  </p>
                  <FamilyExperienceEvidence evidence={data.familyExperience} />
                  {!reviews.length && (
                    <p className="research-empty">
                      No researched excerpts match this view.{" "}
                      {data.reviewAggregates.length
                        ? "Use the review-page links below to read available reviews."
                        : "No location-matched rating-page links are retained here."}{" "}
                      Missing excerpts do not mean no reviews exist.
                    </p>
                  )}
                  <div className="public-reviews">
                    {reviews.map((review) => {
                      const reviewSource = data.sources.find(
                        (source) => source.id === review.sourceId,
                      );
                      return (
                        <article
                          id={uid + "-account-" + review.id}
                          key={review.id}
                          tabIndex={-1}
                          ref={
                            targetId === `${uid}-account-${review.id}`
                              ? targetRef
                              : undefined
                          }
                        >
                          <div className="review-meta">
                            <strong>
                              {reviewSource?.publisher ??
                                "Source not established"}
                              {reviewSource?.kind === "provider" &&
                                " · Provider-selected testimonial"}
                            </strong>
                            <span>
                              {review.relationship === "unknown"
                                ? "Relationship not established"
                                : `Self-described ${review.relationship}`}
                            </span>
                            <span>
                              {date(review.date)}
                              {review.rating !== null
                                ? ` · ${review.rating}/${review.scale}`
                                : ""}
                            </span>
                          </div>
                          {review.excerpt ? (
                            <blockquote>“{review.excerpt}”</blockquote>
                          ) : (
                            <p className="review-summary">
                              <strong>Research summary</strong> ·{" "}
                              {review.summary}
                            </p>
                          )}
                          <div className="review-aspects">
                            {review.aspects.map((aspect, i) => (
                              <span
                                key={i}
                                className={`sentiment-${aspect.sentiment}`}
                              >
                                {aspect.aspect} · {aspect.sentiment}
                              </span>
                            ))}
                          </div>
                          {(review.notes.length > 0 ||
                            (review.excerpt && review.summary)) && (
                            <details className="evidence-disclosure">
                              <summary>Account context</summary>
                              {review.excerpt && review.summary && (
                                <p>
                                  <strong>Research summary</strong> ·{" "}
                                  {review.summary}
                                </p>
                              )}
                              {review.notes.map((note, i) => (
                                <p key={i}>{note}</p>
                              ))}
                            </details>
                          )}
                          <a
                            className="research-source"
                            href={review.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Read the original account
                            {reviewSource
                              ? ` on ${reviewSource.publisher}`
                              : ""}
                            <ExternalLink size={12} />
                          </a>
                          {reviewSource?.access === "search-result" && (
                            <p className="small">
                              Search result only. The full page was not
                              reviewed.
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  <FacebookResearch
                    key={providerId}
                    research={data.facebookResearch}
                  />
                </section>
                <section aria-labelledby={`${uid}-ratings`}>
                  <h4 id={`${uid}-ratings`}>
                    Review ratings & source coverage
                  </h4>
                  <div className="experience-overview">
                    <div className="experience-number">
                      {data.experience.value === null ? (
                        <MessageSquare size={28} />
                      ) : (
                        <>
                          {data.experience.value.toFixed(1)}
                          <small>/10</small>
                        </>
                      )}
                    </div>
                    <div>
                      <h4>{data.experience.label}</h4>
                      <p>
                        {data.experience.publicationStatus ===
                        "sources-disagree"
                          ? "Harbor score withheld · Sources disagree"
                          : data.experience.value === null
                            ? "Not rated yet"
                            : `${data.experience.confidence === "moderate" ? "Moderate" : "Limited"} evidence · ${data.experience.reviewCount} reviews reported · ${data.experience.independentSourceCount} source ${data.experience.independentSourceCount === 1 ? "family" : "families"}`}
                      </p>
                    </div>
                  </div>
                  {data.experience.publicationStatus ===
                    "single-source-estimate" && (
                    <p>
                      Single-source estimate ·{" "}
                      {data.experience.singleSourceLabel}
                    </p>
                  )}
                  {data.experience.selectedConcerns && (
                    <p>Selected reviews include concerns.</p>
                  )}
                  <p className="research-intro">
                    Consumer ratings, not a clinical-quality score.
                  </p>
                  <details className="evidence-disclosure experience-method">
                    <summary>How to read this score</summary>
                    <p>{data.experience.reason}</p>
                    <p>
                      A provisional summary of consumer ratings, not a
                      clinical-quality score. Reviewers are not independently
                      authenticated. Tour reviews may be included, and counts
                      can overlap across sites. Read the inspection evidence
                      too.
                    </p>
                    <Link
                      href="/methodology#experience"
                      target="_blank"
                      className="text-link"
                    >
                      How this score works <ExternalLink size={13} />
                    </Link>
                  </details>
                  {data.reviewLinks && data.reviewLinks.length > 0 && (
                    <div className="search-research-links">
                      {data.reviewLinks.map((link) => (
                        <a
                          className="research-source"
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Read independent reviews on {link.publisher}{" "}
                          <ExternalLink size={12} />
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
                    {data.reviewAggregates.map((aggregate, i) => (
                      <article key={`${aggregate.sourceId}-${i}`}>
                        <strong>{aggregate.platform}</strong>
                        <span>
                          {aggregate.rating === null
                            ? "Rating not established"
                            : `${aggregate.rating} / ${aggregate.scale}`}{" "}
                          ·{" "}
                          {aggregate.count === null
                            ? "Count unknown"
                            : `${aggregate.count} reviews`}
                        </span>
                        <p className="small">
                          {aggregate.scope} · Rating as of{" "}
                          {date(aggregate.asOf)}
                        </p>
                        <SourceLink
                          label={`Read reviews on ${aggregate.platform}`}
                          source={data.sources.find(
                            (s) => s.id === aggregate.sourceId,
                          )}
                        />
                        {aggregate.notes.length > 0 && (
                          <details className="evidence-disclosure">
                            <summary>Source context</summary>
                            {aggregate.notes.map((note, j) => (
                              <p key={j}>{note}</p>
                            ))}
                          </details>
                        )}
                        {data.experience.excludedSources
                          .filter((s) => s.sourceId === aggregate.sourceId)
                          .map((s, j) => (
                            <p className="review-excluded" key={j}>
                              Excluded from index: {s.reason}
                            </p>
                          ))}
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
            {pane === "details" && facts(["capacity"]).length > 0 && (
              <section aria-labelledby={`${uid}-capacity`}>
                <h4 id={`${uid}-capacity`}>Community size</h4>
                <Facts
                  facts={facts(["capacity"])}
                  sources={data.sources}
                  empty=""
                />
                <details className="evidence-disclosure">
                  <summary>What capacity figures mean</summary>
                  <p>
                    Capacity and historical resident averages are not
                    today&apos;s occupancy. They cannot tell us how many rooms
                    are open.
                  </p>
                </details>
              </section>
            )}
          </div>
          {pane === "details" && data.notes.length > 0 && (
            <details className="research-notes">
              <summary>Source differences & research limits</summary>
              <ul>
                {data.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
