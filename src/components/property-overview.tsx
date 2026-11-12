import type {
  LocationResearchResponse,
  OfferingFact,
} from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import type { NavigateProfile } from "./profile-pane";
import { evidenceDate } from "./evidence-date";
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

function perkPreview(text: string) {
  const preview = text
    .split(/\.\s/)[0]
    .replace(/^The independent-living package advertises /, "")
    .split(/,\s/)
    .slice(0, 2)
    .join(", ")
    .replace(/^./, (letter) => letter.toUpperCase());
  return preview.length > 110
    ? preview.slice(0, 110).replace(/\s+\S*$/, "") + "…"
    : preview.replace(/\.?$/, ".");
}

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
  const office = provider.locationKind === "office";
  const costLabel = cost?.amount
    ? cost.text
        .split(/\$\s*\d/)[0]
        .replace(/^(?:The |Published )/i, "")
        .replace(
          /\s*(?::|(?:is |are )?(?:published |advertised )?(?:starting |starts |from )?at|advertises|lists)\s*$/i,
          "",
        )
        .replace(/\s+Monthly Service Package$/i, "")
        .trim() || costLabels[cost.amount.type]
    : office
      ? "Service rates"
      : "Rooms & pricing";
  const priceTiming = cost?.text.match(
    /(?:effective|valid (?:until|through)|schedule changes)\s+[^.;]+/i,
  )?.[0];
  const extraFee = cost?.text.match(
    /plus\s+(?:an?\s+)?(?:one-time\s+)?\$[\d,.]+[^.;]*/i,
  )?.[0];
  const practical = (
    office ? ["care", "amenity"] : ["dining", "amenity", "activity"]
  )
    .flatMap((kind) => {
      const matches = data.facts.filter((fact) => fact.kind === kind);
      return (
        matches.find((fact) => sourceFor(fact.sourceId)?.kind === "provider") ??
        matches[0] ??
        []
      );
    })
    .slice(0, 2);
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
  const excerpt =
    account && account.excerpt.length > 160
      ? account.excerpt.slice(0, 160).replace(/\s+\S*$/, "") + "…"
      : account?.excerpt;
  const concern = reviews.find((review) =>
    review.aspects.some(({ sentiment }) => sentiment !== "positive"),
  );

  return (
    <div
      className="property-overview"
      role="region"
      aria-label="Property overview"
    >
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
            {!cost.amount && <p>{cost.text}</p>}
            {entrance && cost !== entrance && (
              <p className="small">
                Separate entrance fee
                {entrance.amount
                  ? ` ${money(entrance.amount.min)}${entrance.amount.max !== null && entrance.amount.max !== entrance.amount.min ? "–" + money(entrance.amount.max) : ""}`
                  : ""}
                .
              </p>
            )}
            {extraFee && (
              <small>
                {extraFee.charAt(0).toUpperCase() + extraFee.slice(1)}.
              </small>
            )}
            {(!cost.amount ||
              cost.amount.period === "one-time" ||
              cost.amount.min === 0) && (
              <p className="small">An ongoing rate has not been verified.</p>
            )}
            {(priceTiming || cost.asOf || cost.amount?.asOf) && (
              <small>
                {priceTiming
                  ? priceTiming.charAt(0).toUpperCase() +
                    priceTiming.slice(1) +
                    "."
                  : `Effective ${evidenceDate(cost.asOf || cost.amount?.asOf)}.`}
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
      <div className="overview-life">
        {practical.length ? (
          practical.map((fact) => (
            <div key={fact.id} className="overview-fact">
              <p>{perkPreview(fact.text)}</p>
            </div>
          ))
        ) : (
          <p>
            {provider.services.slice(0, 2).join(" · ") ||
              "Everyday offerings have not been researched yet."}
          </p>
        )}
        <button
          className="overview-more"
          onClick={() => onNavigate({ pane: "costs" })}
        >
          All perks & services
        </button>
      </div>
      <div className="overview-experience">
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
            No quoted public review is retained here. The Reviews pane has
            source links and any available family discussions.
          </p>
        )}
        <button
          className="overview-more"
          onClick={() =>
            onNavigate({
              pane: "reviews",
              targetId: account ? `${uid}-account-${account.id}` : undefined,
            })
          }
        >
          {account
            ? "Full review & context"
            : "Explore reviews & family discussions"}
        </button>
        <details className="overview-caveat">
          <summary>About this review</summary>
          <p>
            {account && `${evidenceDate(account.date)}. `}
            Selected accounts, not a survey. Relationships are not independently
            verified.
          </p>
          {data.experience.publicationStatus === "sources-disagree" && (
            <p>Harbor score withheld · Sources disagree</p>
          )}
          {data.experience.publicationStatus === "single-source-estimate" && (
            <p>
              Single-source estimate ·{" "}
              {data.experience.singleSourceLabel ?? "one review source"}
            </p>
          )}
        </details>
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
