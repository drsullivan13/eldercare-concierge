"use client";
import { useEffect, useId, useState } from "react";
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
  const [attempt, setAttempt] = useState(0);
  const [taskAdded, setTaskAdded] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  const [state, setState] = useState<{
    key: string;
    data?: LocationResearchResponse;
    error?: string;
  }>({ key: "" });
  const key = `${providerId}:${attempt}`;
  const data = state.key === key ? state.data : undefined;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/research?${new URLSearchParams({ id: providerId })}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("The location research could not be loaded.");
        const result = (await response.json()) as LocationResearchResponse;
        if (result.providerId !== providerId)
          throw new Error("The research did not match this location.");
        if (!controller.signal.aborted) setState({ key, data: result });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Research is unavailable.",
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [providerId, key]);
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
        <h3 id={`${uid}-title`}>A closer look at this option</h3>
        {data?.checkedAt && (
          <span>Research checked {date(data.checkedAt)}</span>
        )}
      </div>
      {state.key !== key && (
        <p role="status" className="small muted">
          Loading offerings, availability and review evidence…
        </p>
      )}
      {state.key === key && state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button
            className="button button-outline"
            onClick={() => setAttempt((v) => v + 1)}
          >
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
                <p className="small muted">
                  Offerings below are described by the linked sources. Ask which
                  are included in the specific care level and contract you are
                  considering.
                </p>
                <Facts
                  facts={facts(["care", "amenity", "activity", "dining"])}
                  sources={data.sources}
                  empty="Detailed amenities and activities have not been researched for this location yet. Missing detail does not mean the service is unavailable."
                />
                <h4>Community size</h4>
                <Facts
                  facts={facts(["capacity"])}
                  sources={data.sources}
                  empty="No sourced size or resident-count figures are available in this snapshot."
                />
                {facts(["capacity"]).length > 0 && (
                  <p className="research-caution">
                    Capacity and historical resident averages are not today’s
                    occupancy. They cannot tell us how many rooms are open.
                  </p>
                )}
              </>
            )}
            {tab === "rooms" && (
              <>
                <h4>Room types & living arrangements</h4>
                <Facts
                  facts={facts(["room"])}
                  sources={data.sources}
                  empty="Room layouts and sharing arrangements have not been established in this research. Ask for current floor plans for the relevant care level."
                />
                <h4>Published costs & what they include</h4>
                <p className="small muted">
                  Keep entrance fees, monthly charges and extra care fees
                  separate. These are published figures, not a personal quote;
                  dates and conditions can change the bill.
                </p>
                <Facts
                  facts={facts(["cost"])}
                  sources={data.sources}
                  empty="No location-specific published price has been established. We do not substitute a regional estimate. Request an itemized quote for the room and care needed."
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
                <Facts
                  facts={facts(["availability"])}
                  sources={data.sources}
                  empty="No additional room-specific availability evidence is published in this snapshot."
                />
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
                    <span className="small muted">
                      {data.experience.reason}
                    </span>
                  </div>
                </div>
                <p className="research-caution">
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
                <FacebookResearch
                  key={providerId}
                  research={data.facebookResearch}
                />
                <h4>What each source reports</h4>
                {!data.reviewAggregates.length && (
                  <p className="research-empty">
                    No location-matched rating aggregates have been researched
                    yet. This is not a finding that no reviews exist.
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
                      {aggregate.notes.map((note, j) => (
                        <p className="small muted" key={j}>
                          {note}
                        </p>
                      ))}
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
                <p className="small muted">
                  These examples provide context, not a representative survey.
                  Relationships are self-described. The selected excerpts do not
                  affect the numerical score.
                </p>
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
                      {review.notes.map((note, i) => (
                        <p key={i} className="small muted">
                          {note}
                        </p>
                      ))}
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
