"use client";
import { useId, useState } from "react";
import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import {
  CalendarClock,
  Check,
  ExternalLink,
  MessageSquare,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { FacebookResearch } from "./facebook-research";
import type {
  LocationResearchResponse,
  OfferingFact,
  ResearchSource,
} from "@/lib/location-research-types";

const TABS = [
  { id: "life", label: "Life here" },
  { id: "rooms", label: "Rooms & costs" },
  { id: "availability", label: "Availability" },
  { id: "reviews", label: "Reviews" },
] as const;
type Tab = (typeof TABS)[number]["id"];
function date(value: string | null | undefined) {
  if (!value) return "Date not published";
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : value;
}
function price(fact: OfferingFact) {
  if (!fact.amount) return null;
  const { min, max, period } = fact.amount;
  const format = (v: number) =>
    v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  return `${format(min)}${max === null ? "" : `–${format(max)}`} ${period === "one-time" ? "one-time" : `/ ${period}`}`;
}
function SourceLink({ source }: { source?: ResearchSource }) {
  if (!source) return null;
  return (
    <a
      className="research-source"
      href={source.url}
      target="_blank"
      rel="noreferrer"
    >
      {source.publisher} · checked {date(source.checkedAt)}
      {source.access === "search-result" ? " · search result only" : ""}
      <ExternalLink size={12} />
    </a>
  );
}
function Facts({
  facts,
  sources,
  empty,
}: {
  facts: OfferingFact[];
  sources: ResearchSource[];
  empty: string;
}) {
  if (!facts.length) return <p className="research-empty">{empty}</p>;
  return (
    <div className="offering-facts">
      {facts.map((fact) => (
        <article key={fact.id} className={`offering-fact fact-${fact.kind}`}>
          {fact.amount && (
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
      ))}
    </div>
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
  providerId,
  providerName,
  onTask,
}: {
  providerId: string;
  providerName: string;
  onTask: (title: string) => boolean;
}) {
  const uid = useId();
  const [tab, setTab] = useState<Tab>("life");
  const [taskAdded, setTaskAdded] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  const { data, error, loading, retry } =
    useProviderEvidence<LocationResearchResponse>(providerId, source);
  const facts = (kinds: OfferingFact["kind"][]) =>
    data?.facts.filter((f) => kinds.includes(f.kind)) ?? [];
  const availabilitySource = data?.sources.find(
    (s) => s.id === data.availability.sourceId,
  );
  const reviews =
    data?.reviews.filter(
      (r) =>
        !familyOnly ||
        r.relationship === "family" ||
        r.relationship === "resident",
    ) ?? [];

  return (
    <section className="location-research" aria-labelledby={`${uid}-title`}>
      <div className="section-title">
        <h3 id={`${uid}-title`}>Explore this care option</h3>
        {data?.checkedAt && (
          <span>Research checked {date(data.checkedAt)}</span>
        )}
      </div>
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
      {data && (
        <>
          {data.admissionRestriction && (
            <div className="research-caution">
              <strong>Admission eligibility needs checking</strong>
              <p>{data.admissionRestriction.text}</p>
              <SourceLink
                source={data.sources.find(
                  (s) => s.id === data.admissionRestriction?.sourceId,
                )}
              />
            </div>
          )}
          <div
            className="research-tabs"
            aria-label="Location research sections"
          >
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setTab(item.id)}
                className={tab === item.id ? "active" : ""}
                aria-pressed={tab === item.id}
                aria-controls={`${uid}-panel`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            id={`${uid}-panel`}
            className="research-panel"
            aria-live="polite"
          >
            {tab === "life" && (
              <>
                <h4>Care, amenities & everyday life</h4>
                <p className="research-intro">
                  Ask which services are included in your care level and
                  contract.
                </p>
                <Facts
                  facts={facts(["care", "amenity", "activity", "dining"])}
                  sources={data.sources}
                  empty="Amenities and activities have not been researched yet. Ask the provider what is available."
                />
                {facts(["capacity"]).length > 0 && (
                  <>
                    <h4>Community size</h4>
                    <Facts
                      facts={facts(["capacity"])}
                      sources={data.sources}
                      empty=""
                    />
                    <details className="evidence-disclosure">
                      <summary>What capacity figures mean</summary>
                      <p>
                        Capacity and historical resident averages are not
                        today’s occupancy. They cannot tell us how many rooms
                        are open.
                      </p>
                    </details>
                  </>
                )}
              </>
            )}
            {tab === "rooms" && (
              <>
                <h4>Room types & living arrangements</h4>
                <Facts
                  facts={facts(["room"])}
                  sources={data.sources}
                  empty="Room layouts have not been researched yet. Ask for current floor plans and sharing arrangements."
                />
                <h4>Published costs & what they include</h4>
                <p className="research-intro">
                  Published prices are not a personal quote. Check the dates and
                  what is included.
                </p>
                <Facts
                  facts={facts(["cost"])}
                  sources={data.sources}
                  empty="Pricing has not been established for this location. Request an itemized quote for the room and care needed."
                />
                <div className="research-question">
                  <strong>Ask for the complete bill</strong>
                  <p>
                    Room or rent, assessed care, medication support,
                    second-person fees, deposits, annual increases, refund terms
                    and any minimum stay.
                  </p>
                </div>
              </>
            )}
            {tab === "availability" && (
              <>
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
                {facts(["availability"]).length > 0 && (
                  <Facts
                    facts={facts(["availability"])}
                    sources={data.sources}
                    empty=""
                  />
                )}
                <div className="research-question">
                  <strong>Confirm the opening that fits</strong>
                  <p>
                    Care level, room type, move-in window, assessment
                    requirements, waitlist position, refundable deposit and how
                    long a room can be held.
                  </p>
                  <button
                    className="button button-outline"
                    disabled={taskAdded}
                    onClick={() =>
                      setTaskAdded(
                        onTask(
                          `Ask ${providerName} for room availability, waitlist timing and an itemized quote`.slice(
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
              </>
            )}
            {tab === "reviews" && (
              <>
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
                      {data.experience.value === null
                        ? "Not rated yet"
                        : `${data.experience.confidence === "moderate" ? "Moderate" : "Limited"} evidence · ${data.experience.reviewCount} reviews reported · ${data.experience.independentSourceCount} source ${data.experience.independentSourceCount === 1 ? "family" : "families"}`}
                    </p>
                  </div>
                </div>
                <p className="research-intro">
                  Consumer ratings, not a clinical-quality score.
                </p>
                <details className="evidence-disclosure experience-method">
                  <summary>How to read this score</summary>
                  <p>{data.experience.reason}</p>
                  <p>
                    A provisional summary of consumer ratings, not a
                    clinical-quality score. Reviewers are not independently
                    authenticated. Tour reviews may be included, and counts can
                    overlap across sites. Read the inspection evidence too.
                  </p>
                  <Link
                    href="/methodology#experience"
                    target="_blank"
                    className="text-link"
                  >
                    How this score works <ExternalLink size={13} />
                  </Link>
                </details>
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
                      <SourceLink
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
                <div className="review-section-title">
                  <h4>Selected public experiences</h4>
                  <label>
                    <input
                      type="checkbox"
                      checked={familyOnly}
                      onChange={(e) => setFamilyOnly(e.target.checked)}
                    />{" "}
                    Family & resident accounts
                  </label>
                </div>
                <details className="evidence-disclosure review-method">
                  <summary>About these selected accounts</summary>
                  <p>
                    These examples provide context, not a representative survey.
                    Relationships are self-described. The selected excerpts do
                    not affect the numerical score.
                  </p>
                </details>
                {!reviews.length && (
                  <p className="research-empty">
                    No researched excerpts match this view.
                  </p>
                )}
                <div className="public-reviews">
                  {reviews.map((review) => (
                    <article key={review.id}>
                      <div className="review-meta">
                        <span>
                          {review.relationship === "unknown"
                            ? "Relationship not established"
                            : `${review.relationship[0].toUpperCase()}${review.relationship.slice(1)} account`}
                        </span>
                        <span>
                          {date(review.date)}
                          {review.rating !== null
                            ? ` · ${review.rating}/${review.scale}`
                            : ""}
                        </span>
                      </div>
                      {review.excerpt && (
                        <blockquote>“{review.excerpt}”</blockquote>
                      )}
                      <p>{review.summary}</p>
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
                      {review.notes.length > 0 && (
                        <details className="evidence-disclosure">
                          <summary>Account context</summary>
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
                        Read the original account <ExternalLink size={12} />
                      </a>
                    </article>
                  ))}
                </div>
                <FacebookResearch
                  key={providerId}
                  research={data.facebookResearch}
                />
              </>
            )}
          </div>
          {data.notes.length > 0 && (
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
