import type {
  LocationResearchResponse,
  OfferingFact,
} from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import { evidenceDate } from "./evidence-date";
import "./property-overview.css";

type Account = LocationResearchResponse["reviews"][number];

function hasConcern(account: Account) {
  return account.aspects.some(({ sentiment }) => sentiment !== "positive");
}

function previewCost(facts: OfferingFact[]) {
  const costs = facts.filter((f) => f.kind === "cost");
  return (
    costs.find(
      (f) =>
        f.amount &&
        f.amount.min > 0 &&
        f.amount.period !== "one-time" &&
        !/second.person|additional person/i.test(f.text),
    ) ??
    costs.find((f) => f.amount && f.amount.min > 0) ??
    costs[0]
  );
}

export function PropertyOverview({
  data,
  provider,
  uid,
  reviews,
}: {
  data: LocationResearchResponse;
  provider: Provider;
  uid: string;
  reviews: Account[];
}) {
  const cost = previewCost(data.facts);
  const entrance = data.facts.find((f) => f.amount?.type === "entrance-fee");
  const office = provider.locationKind === "office";
  const preferredKinds = office
    ? ["care", "amenity"]
    : ["room", "dining", "amenity", "activity"];
  const practical = preferredKinds
    .flatMap((kind) => {
      const matches = data.facts.filter((f) => f.kind === kind);
      return (
        matches.find((f) =>
          data.sources.some(
            (s) => s.id === f.sourceId && s.kind === "provider",
          ),
        ) ??
        matches[0] ??
        []
      );
    })
    .slice(0, 2);
  const sourceFor = (id: string) => data.sources.find((s) => s.id === id);
  const quotes = reviews.filter((r) => r.excerpt);
  const family = quotes.filter(
    (r) => r.relationship === "family" || r.relationship === "resident",
  );
  const independent = family.find(
    (r) => sourceFor(r.sourceId)?.kind !== "provider",
  );
  const social = data.facebookResearch?.findings.find(
    (f) => f.kind === "resident-family" && f.excerpt,
  );
  const account =
    independent ?? (!social ? (family[0] ?? quotes[0]) : undefined);
  const quote = account?.excerpt ?? social?.excerpt;
  const quoteUrl = account?.url ?? social?.sourceUrl;
  const quoteDate = account ? account.date : social?.date;
  const excerpt =
    quote && quote.length > 160
      ? quote.slice(0, 160).replace(/\s+\S*$/, "") + "…"
      : quote;
  const money = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  const author = account
    ? [
        account.relationship === "unknown"
          ? "Public reviewer"
          : "Self-described " + account.relationship,
        sourceFor(account.sourceId)?.kind === "provider"
          ? "provider-selected testimonial"
          : sourceFor(account.sourceId)?.publisher,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Resident or family account · Facebook";
  const concern = reviews.find(hasConcern);
  const aggregate = data.reviewAggregates.find((item) =>
    sourceFor(item.sourceId),
  );
  const aggregateSource = aggregate && sourceFor(aggregate.sourceId);
  const link =
    data.reviewLinks?.[0] ??
    (aggregateSource && {
      publisher: aggregateSource.publisher,
      url: aggregateSource.url,
    });
  const score = data.experience;
  const scoreText =
    score.publicationStatus === "sources-disagree"
      ? "Harbor score withheld · Sources disagree"
      : score.publicationStatus === "single-source-estimate"
        ? "Single-source estimate · " +
          (score.singleSourceLabel ?? "one review source")
        : null;
  return (
    <div
      className="property-overview"
      role="region"
      aria-label="Property overview"
    >
      <div>
        <h4>
          <a href={"#" + uid + "-costs"}>
            {office ? "Service rates" : "Rooms & pricing"}
          </a>
        </h4>
        {cost ? (
          <>
            <p>
              {cost.amount && !/\$\s*\d/.test(cost.text) ? (
                <strong>
                  {money(cost.amount.min)}
                  {cost.amount.max !== null &&
                  cost.amount.max !== cost.amount.min
                    ? "–" + money(cost.amount.max)
                    : ""}{" "}
                  {cost.amount.period === "one-time"
                    ? "one time"
                    : "per " + cost.amount.period}
                  .{" "}
                </strong>
              ) : null}
              {cost.text.replace(/\. Confirm the current quote\.$/, ".")}
            </p>
            {entrance && cost !== entrance && (
              <p className="small">
                A separate one-time entrance fee is listed.
              </p>
            )}
            {(!cost.amount ||
              cost.amount.period === "one-time" ||
              cost.amount.min === 0) && (
              <p className="small">
                An ongoing rate has not been verified for this option.
              </p>
            )}
            <small>{sourceFor(cost.sourceId)?.publisher}</small>
          </>
        ) : (
          <p>
            {office
              ? "No verified visit or hourly rate. Ask for rates and minimum shifts."
              : "No verified room rate. Ask for rent, care charges and fees."}
          </p>
        )}
      </div>
      <div>
        <h4>
          <a href={"#" + uid + "-life"}>
            {office ? "Care at home" : "Rooms & everyday life"}
          </a>
        </h4>
        {practical.length ? (
          practical.map((f) => (
            <p key={f.id}>
              {f.text.replace(
                /\. Confirm these details with the location\.$/,
                ".",
              )}
            </p>
          ))
        ) : (
          <p>
            {provider.services.slice(0, 2).join(" · ") ||
              "Offering details have not been verified."}
          </p>
        )}
      </div>
      <div>
        <h4>
          <a href={"#" + uid + "-reviews"}>Resident & family experiences</a>
        </h4>
        {scoreText && (
          <p>
            <strong>{scoreText}</strong>
          </p>
        )}
        {excerpt ? (
          <>
            <blockquote>“{excerpt}”</blockquote>
            <small>
              <a href={quoteUrl} target="_blank" rel="noreferrer">
                {author} · {evidenceDate(quoteDate)}
              </a>
            </small>
          </>
        ) : (
          <p>No published firsthand excerpt is available here.</p>
        )}
        {score.selectedConcerns && !concern && (
          <p>Selected reviews include concerns.</p>
        )}
        {concern && (
          <a
            href={"#" + uid + "-account-" + concern.id}
            className="overview-more"
          >
            Read an account with concerns
          </a>
        )}
        {!quote && link && (
          <a
            className="overview-more"
            target="_blank"
            rel="noreferrer"
            href={link.url}
          >
            Open reviews on {link.publisher}
          </a>
        )}
      </div>
    </div>
  );
}
