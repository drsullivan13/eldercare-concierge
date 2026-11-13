"use client";
import { useEffect, useRef, useState } from "react";
import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import { CalendarClock, Check, ExternalLink, Plus } from "lucide-react";
import { evidenceDate as date } from "./evidence-date";
import { PropertyOverview } from "./property-overview";
import { DailyLife } from "./daily-life";
import { IndividualReviewList } from "./individual-review-list";
import { ExperienceExplanation } from "./experience-explanation";
import type {
  LocationResearchResponse,
  OfferingFact,
  ResearchSource,
} from "@/lib/location-research-types";
import { dailyLife } from "@/lib/daily-life-display";
import { isServiceProvider, type Provider } from "@/lib/providers";
import type { ProfileNavigation } from "./profile-pane";
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
  targetRef?: React.RefObject<HTMLLIElement | null>;
}) {
  if (!facts.length)
    return empty ? <p className="research-empty">{empty}</p> : null;
  const items = facts.map((fact) => (
    <li
      key={fact.id}
      id={uid ? `${uid}-price-${fact.id}` : undefined}
      ref={
        uid && targetId === `${uid}-price-${fact.id}` ? targetRef : undefined
      }
      tabIndex={-1}
      className={`offering-fact research-fact fact-${fact.kind}`}
    >
      {fact.amount && (
        <h5 className="cost-label">
          {COST_LABELS[fact.amount.type]} ·{" "}
          {fact.amount.period === "one-time"
            ? "One-time"
            : `Per ${fact.amount.period}`}
        </h5>
      )}
      {fact.kind === "capacity" && fact.unit && (
        <h5 className="fact-heading">{fact.unit}</h5>
      )}
      {fact.amount && !/\$\s*\d/.test(fact.text) && (
        <strong className="offering-price">{price(fact)}</strong>
      )}
      <p>
        {fact.text
          .split(
            /(\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:[-–—]|to)\s*\$?\s*\d[\d,]*(?:\.\d+)?)?)/g,
          )
          .map((part, index) =>
            index % 2 ? <strong key={index}>{part}</strong> : part,
          )}
      </p>
      <footer className="fact-provenance">
        {(fact.asOf || fact.amount?.asOf) && (
          <span className="small muted">
            Source effective date: {date(fact.asOf || fact.amount?.asOf)}
          </span>
        )}
        <SourceLink
          source={sources.find((source) => source.id === fact.sourceId)}
        />
      </footer>
    </li>
  ));
  const limit = facts.length > 3 ? 2 : facts.length;
  return (
    <>
      <ul className="offering-facts" role="list">
        {items.slice(0, limit)}
      </ul>
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
          <ul className="offering-facts" role="list">
            {items.slice(limit)}
          </ul>
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
  uid,
}: {
  provider: Provider;
  onTask: (title: string) => boolean;
  navigation: ProfileNavigation;
  uid: string;
}) {
  const { id: providerId, name: providerName } = provider;
  const office = isServiceProvider(provider);
  const { pane, targetId } = navigation;
  const targetRef = useRef<HTMLLIElement>(null);
  const [taskAdded, setTaskAdded] = useState(false);
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
  const offeringFacts = facts(["care", "amenity", "activity", "dining"]);
  const displayedFacts = [
    ...offeringFacts,
    ...(data
      ? dailyLife(data, provider).groups.flatMap((group) =>
          group.facts.map(({ fact }) => fact),
        )
      : []),
  ];
  const licensingFacts = offeringFacts.filter(
    (fact) =>
      data?.sources.find((source) => source.id === fact.sourceId)?.kind ===
      "regulator",
  );
  const catalogServices = provider.services.filter(
    (service) =>
      !displayedFacts.some((fact) =>
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
  const costFacts = facts(["cost"]);
  const amenities = data && (
    <section aria-labelledby={`${uid}-life`}>
      <h4 id={`${uid}-life`}>Amenities & everyday life</h4>
      <DailyLife data={data} provider={provider} section="amenities" />
    </section>
  );

  return (
    <section
      className="location-research"
      aria-label={pane === "overview" ? "Overview" : undefined}
      aria-labelledby={pane === "overview" ? undefined : `${uid}-title`}
    >
      {pane === "costs" && (
        <h3 id={`${uid}-title`} className="research-title-hidden">
          Amenities & costs
        </h3>
      )}
      {pane === "details" && (
        <div className="section-title">
          <h3 id={`${uid}-title`}>Availability & services</h3>
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
      {pane === "overview" && <PropertyOverview provider={provider} />}
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
          <div
            className={`research-panel${pane === "costs" ? " costs-perks" : ""}`}
          >
            {pane === "costs" && (
              <>
                {costFacts.length === 0 && amenities}
                <section aria-labelledby={`${uid}-costs`}>
                  <h4 id={`${uid}-costs`}>
                    Published costs & what they include
                  </h4>
                  <Facts
                    facts={costFacts}
                    sources={data.sources}
                    uid={uid}
                    targetId={targetId}
                    targetRef={targetRef}
                    empty="Pricing is not published here. Request an itemized quote."
                  />
                  {costFacts.length > 0 && (
                    <p className="research-price-note">
                      Published prices are not a personal quote. Check the dates
                      and what is included.
                    </p>
                  )}
                  {costFacts.length > 0 &&
                    !costFacts.some(
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
                    <h5>Ask for the complete bill</h5>
                    <ul className="research-specifics">
                      {(office
                        ? [
                            "Hourly or visit rates and minimum shifts.",
                            "Overnight or live-in charges and nursing fees.",
                            "Cancellation terms and what insurance covers.",
                          ]
                        : [
                            "Room or rent, assessed care and medication support.",
                            "Second-person fees, deposits and annual increases.",
                            "Refund terms and any minimum stay.",
                          ]
                      ).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </section>
                {costFacts.length > 0 && amenities}
                <section aria-labelledby={`${uid}-rooms`}>
                  <h4 id={`${uid}-rooms`}>
                    {office
                      ? "How care is delivered"
                      : "Room types & living arrangements"}
                  </h4>
                  <Facts
                    facts={facts(["room"])}
                    sources={data.sources}
                    empty={
                      office
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
                  <h5>Confirm the opening that fits</h5>
                  <ul className="research-specifics">
                    {(office
                      ? [
                          "Service at your address and care needs.",
                          "Staff availability, start date and minimum shifts.",
                          "Assessment requirements.",
                        ]
                      : [
                          "Care level, room type and move-in window.",
                          "Assessment requirements and waitlist position.",
                          "Refundable deposit and how long a room can be held.",
                        ]
                    ).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <button
                    className="button button-outline"
                    disabled={taskAdded}
                    onClick={() =>
                      setTaskAdded(
                        onTask(
                          `Ask ${providerName} for ${office ? "staff availability, start dates" : "room availability, waitlist timing"} and an itemized quote`.slice(
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
                <IndividualReviewList
                  research={data}
                  uid={uid}
                  targetId={targetId}
                />
                <ExperienceExplanation data={data} uid={uid} />
              </>
            )}
            {pane === "details" && (
              <section aria-labelledby={`${uid}-care-team`}>
                <h4 id={`${uid}-care-team`}>Care team & daily support</h4>
                <DailyLife data={data} provider={provider} section="care" />
              </section>
            )}
            {pane === "details" && licensingFacts.length > 0 && (
              <section aria-labelledby={`${uid}-licensing`}>
                <h4 id={`${uid}-licensing`}>Licensing & care setting</h4>
                <Facts facts={licensingFacts} sources={data.sources} empty="" />
              </section>
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
