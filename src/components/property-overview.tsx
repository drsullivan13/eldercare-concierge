import type {
  LocationResearchResponse,
  OfferingFact,
} from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import type { NavigateProfile } from "./profile-pane";
import { evidenceDate } from "./evidence-date";
import { DailyLife } from "./daily-life";
import "./property-overview.css";

type Account = LocationResearchResponse["reviews"][number];

const costLabels = {
  "base-rent": "Published room rate",
  "care-fee": "Published care fee",
  "entrance-fee": "Published entrance fee",
  other: "Published charge",
} satisfies Record<NonNullable<OfferingFact["amount"]>["type"], string>;

function previewCost(facts: OfferingFact[]) {
  const costs = facts.filter((fact) => fact.kind === "cost");
  const ongoing = costs.filter(
    (fact) =>
      fact.amount &&
      fact.amount.min > 0 &&
      fact.amount.period !== "one-time" &&
      !/second.person|additional person/i.test(fact.text),
  );
  return (
    ongoing.find((fact) => fact.amount?.type === "base-rent") ??
    ongoing[0] ??
    costs.find((fact) => fact.amount && fact.amount.min > 0) ??
    costs[0]
  );
}

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

export function PropertyOverview({
  data,
  provider,
  uid,
  reviews,
  onNavigate,
}: {
  data: LocationResearchResponse;
  provider: Provider;
  uid: string;
  reviews: Account[];
  onNavigate: NavigateProfile;
}) {
  const cost = previewCost(data.facts);
  const sourceFor = (id: string) =>
    data.sources.find((source) => source.id === id);
  const entrance = data.facts.find(
    (fact) => fact.amount?.type === "entrance-fee",
  );
  const office = provider.locationKind !== "facility";
  const costLabel = cost?.amount
    ? costLabels[cost.amount.type]
    : office
      ? "Service rates"
      : "Rooms & pricing";
  const quotes = reviews.filter((review) => review.excerpt);
  const family = quotes.filter(
    (review) =>
      review.relationship === "family" || review.relationship === "resident",
  );
  const account =
    family.find((review) => sourceFor(review.sourceId)?.kind !== "provider") ??
    family[0] ??
    quotes[0];
  const quoteSource = account && sourceFor(account.sourceId);
  const excerpt = account?.excerpt;
  const concern = reviews.find((review) =>
    review.aspects.some(({ sentiment }) => sentiment !== "positive"),
  );
  const catalog = !account ? provider.research?.individualReviews : undefined;
  const reviewLink = account
    ? "Full review & context"
    : catalog?.withText
      ? `Read ${catalog.withText} review${catalog.withText === 1 ? "" : "s"}`
      : catalog?.total
        ? `Browse ${catalog.total} review link${catalog.total === 1 ? "" : "s"}`
        : "Explore reviews & family discussions";

  return (
    <div
      className="property-overview"
      role="region"
      aria-label="Property overview"
    >
      <div className="overview-life">
        <h4>{office ? "Daily help & care team" : "Daily life & care team"}</h4>
        <DailyLife data={data} provider={provider} compact />
        <button
          className="overview-more"
          onClick={() => onNavigate({ pane: "costs" })}
        >
          All perks & services
        </button>
      </div>
      <div className="overview-price">
        <h4>{costLabel}</h4>
        {cost ? (
          <>
            {cost.amount && (
              <p className="overview-rate">
                {/starting|starts at|from\s*\$/i.test(cost.text) && "From "}
                {money(cost.amount.min)}
                {cost.amount.max !== null && cost.amount.max !== cost.amount.min
                  ? "–" + money(cost.amount.max)
                  : ""}
                <span>
                  {cost.amount.period === "one-time"
                    ? "one time"
                    : "per " + cost.amount.period}
                </span>
              </p>
            )}
            <ul className="overview-terms">
              <li>{cost.text}</li>
              {entrance && cost !== entrance && <li>{entrance.text}</li>}
            </ul>
            {(!cost.amount ||
              cost.amount.period === "one-time" ||
              cost.amount.min === 0) && (
              <p className="small">An ongoing rate has not been verified.</p>
            )}
            {(cost.asOf || cost.amount?.asOf) && (
              <small>
                Effective {evidenceDate(cost.asOf || cost.amount?.asOf)}.
              </small>
            )}
          </>
        ) : (
          <p>
            {office
              ? "No verified visit or hourly rate. Ask for rates and minimum shifts."
              : "No verified room rate. Ask for rent, care charges and fees."}
          </p>
        )}
        <button
          className="overview-more"
          onClick={() =>
            onNavigate({
              pane: "costs",
              targetId: cost ? `${uid}-price-${cost.id}` : undefined,
            })
          }
        >
          {cost ? "Price details & source" : "Explore costs & perks"}
        </button>
      </div>
      <div className="overview-experience">
        <h4>What people say</h4>
        {excerpt && account ? (
          <>
            <blockquote>“{excerpt}”</blockquote>
            <small>
              {account.relationship === "unknown"
                ? "Public reviewer"
                : `Self-described ${account.relationship}`}
              {" · "}
              {quoteSource?.kind === "provider"
                ? "Provider-selected testimonial"
                : (quoteSource?.publisher ?? "Source not established")}
              {quoteSource?.access === "search-result" &&
                " · Search result only"}
            </small>
          </>
        ) : (
          <p>
            {catalog?.withText
              ? "Selected accounts with review text or research summaries."
              : catalog?.total
                ? "Open the original sources to read these individual accounts."
                : "See available review sources and family discussions."}
          </p>
        )}
        <button
          className={`overview-more${catalog?.total ? " overview-catalog-link" : ""}`}
          onClick={() =>
            onNavigate({
              pane: "reviews",
              targetId: account ? `${uid}-account-${account.id}` : undefined,
            })
          }
        >
          {reviewLink}
        </button>
        {catalog &&
          catalog.withText > 0 &&
          catalog.total > catalog.withText && (
            <button
              className="overview-more"
              onClick={() => onNavigate({ pane: "reviews" })}
            >
              Browse {catalog.total - catalog.withText} more review link
              {catalog.total - catalog.withText === 1 ? "" : "s"}
            </button>
          )}
        {account && (
          <details className="overview-caveat">
            <summary>About this review</summary>
            <p>
              {evidenceDate(account.date)}. Selected accounts, not a survey.
              Relationships are not independently verified.
            </p>
          </details>
        )}
        {data.experience.publicationStatus === "sources-disagree" && (
          <p className="overview-concern">
            Harbor score withheld · Sources disagree
          </p>
        )}
        {data.experience.publicationStatus === "single-source-estimate" && (
          <p className="small">
            Single-source estimate ·{" "}
            {data.experience.singleSourceLabel ?? "one review source"}
          </p>
        )}
        {(data.experience.selectedConcerns || concern) && (
          <p className="overview-concern">
            Selected reviews include concerns.{" "}
            <button
              className="overview-more"
              onClick={() =>
                onNavigate({
                  pane: "reviews",
                  targetId: concern
                    ? `${uid}-account-${concern.id}`
                    : undefined,
                })
              }
            >
              Read concerns
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
