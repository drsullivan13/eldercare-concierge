"use client";

import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import type {
  LocationResearchResponse,
  OfferingFact,
  ResearchSource,
} from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import { evidenceDate } from "../evidence-date";
import styles from "./compare-place-facts.module.css";

const source = {
  path: "/api/research",
  idParameter: "id",
  unavailable: "Couldn't load these details.",
  mismatched: "These details belong to another location.",
  fallback: "Couldn't load these details.",
};

const rows = ["Published prices", "Everyday perks", "A review insight"];
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function priceAmount(amount: NonNullable<OfferingFact["amount"]>) {
  return (
    money.format(amount.min) +
    (amount.max !== null && amount.max !== amount.min
      ? `–${money.format(amount.max)}`
      : "")
  );
}

type Insight = {
  text: string;
  quoted: boolean;
  attribution: string;
  url: string;
  date: string | null;
  limitations: string[];
};

function reviewInsight(data: LocationResearchResponse): Insight | undefined {
  const accounts = data.reviews.toSorted((a, b) => {
    const priority = (review: typeof a) =>
      Number(review.aspects.some((aspect) => aspect.sentiment !== "positive")) *
        4 +
      Number(["family", "resident"].includes(review.relationship)) * 2 +
      Number(
        data.sources.find((s) => s.id === review.sourceId)?.kind !== "provider",
      );
    return priority(b) - priority(a);
  });
  const account = accounts.find(
    (review) => review.excerpt || review.aspects.length,
  );
  if (account) {
    const publisher = data.sources.find((s) => s.id === account.sourceId);
    return {
      text:
        account.excerpt ||
        account.aspects
          .map((aspect) => `${aspect.aspect} (${aspect.sentiment})`)
          .slice(0, 2)
          .join(" · "),
      quoted: Boolean(account.excerpt),
      attribution: [
        account.relationship === "unknown"
          ? "Public reviewer"
          : `Self-described ${account.relationship}`,
        publisher?.publisher,
        publisher?.kind === "provider" ? "Provider-selected testimonial" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      url: account.url || publisher?.url || "",
      date: account.date,
      limitations: [
        ...account.notes,
        ...(publisher?.access === "search-result"
          ? ["Search preview only."]
          : []),
      ],
    };
  }
  const finding = data.facebookResearch?.findings.find(
    (item) => item.kind === "resident-family" && item.excerpt,
  );
  if (!finding?.excerpt) return;
  return {
    text: finding.excerpt,
    quoted: true,
    attribution: finding.relationship
      ? `Self-described ${finding.relationship} · Facebook`
      : "Relationship not established · Facebook",
    url: finding.sourceUrl,
    date: finding.date,
    limitations: [
      ...finding.limitations,
      "A campus account does not establish experience in a separate care unit.",
    ],
  };
}

function Source({
  source: researchSource,
  compact = false,
}: {
  source?: ResearchSource;
  compact?: boolean;
}) {
  if (!researchSource) return null;
  return (
    <small className={styles.source}>
      <a href={researchSource.url} target="_blank" rel="noreferrer">
        {researchSource.publisher}
      </a>
      {!compact && ` · Checked ${evidenceDate(researchSource.checkedAt)}`}
      {researchSource.access === "search-result" && " · Search preview only"}
    </small>
  );
}

function Prices({ data }: { data: LocationResearchResponse }) {
  const costs = data.facts.filter((fact) => fact.kind === "cost");
  const recurring = costs.filter(
    (fact) =>
      fact.amount &&
      fact.amount.min > 0 &&
      fact.amount.period !== "one-time" &&
      !/second.person|additional person/i.test(fact.text),
  );
  const lead =
    recurring.find((fact) => fact.amount?.type === "base-rent") ??
    recurring[0] ??
    costs.find((fact) => fact.amount && fact.amount.min > 0);
  const rate = (fact: OfferingFact) =>
    fact.amount && (
      <strong className={styles.price}>
        {priceAmount(fact.amount)}
        <span>
          {fact.amount.period === "one-time"
            ? " one time"
            : ` / ${fact.amount.period}`}
        </span>
      </strong>
    );
  const render = (fact: OfferingFact) => (
    <div className={styles.fact} key={fact.id}>
      {rate(fact)}
      <p>{fact.text}</p>
      {(fact.asOf || fact.amount?.asOf) && (
        <small>Effective {evidenceDate(fact.asOf || fact.amount?.asOf)}</small>
      )}
      <Source source={data.sources.find((item) => item.id === fact.sourceId)} />
    </div>
  );
  if (!costs.length)
    return <p className={styles.muted}>No published price found.</p>;
  const context = lead?.text
    .replace(/^Published /, "")
    .replace(
      / starting at \$[\d,]+(?:\.\d+)?\/(month|day|hour)\.$/,
      " · starting rate",
    )
    .replace(/ starting monthly rate/, " · starting rate")
    .replace(lead.amount ? priceAmount(lead.amount) : "", "")
    .replace(/\b(?:are |is )?published at\s*/i, "")
    .replace(/\bper (?:month|day|hour)\b/, "")
    .replace(/,\s*(?:separate|effective|FUTURE).*$/i, "")
    .replace(/:\s*(?=[.;]|$)/, "")
    .split(/[.;](?:\s|$)/)[0];
  const separateFees =
    costs.some(
      (fact) =>
        fact !== lead &&
        (fact.amount?.type === "entrance-fee" ||
          fact.amount?.type === "care-fee" ||
          /separate|additional|cost extra|not included|one.time.*fee/i.test(
            fact.text,
          )),
    ) ||
    (lead &&
      /separate|additional|cost extra|not included|one.time.*fee/i.test(
        lead.text,
      ));
  return (
    <>
      {lead ? (
        <>
          {rate(lead)}
          <p>{context}</p>
          {(lead.asOf || lead.amount?.asOf) && (
            <small>
              Effective {evidenceDate(lead.asOf || lead.amount?.asOf)}
            </small>
          )}
          {data.sources.find((item) => item.id === lead.sourceId)?.access ===
            "search-result" && <small>Search preview only.</small>}
        </>
      ) : (
        <p className={styles.muted}>Ask for current rates.</p>
      )}
      {!recurring.length && <small>No ongoing rate verified.</small>}
      {separateFees && <small>Separate fees listed. See details.</small>}
      <small className={styles.muted}>Published, not a personal quote.</small>
      <details className={styles.more}>
        <summary>Rates & sources</summary>
        {costs.map(render)}
      </details>
    </>
  );
}

function Perks({ data }: { data: LocationResearchResponse }) {
  const kinds: OfferingFact["kind"][] = [
    "dining",
    "amenity",
    "activity",
    "room",
    "care",
  ];
  const facts = kinds.flatMap((kind) => {
    const matches = data.facts.filter(
      (fact) =>
        fact.kind === kind &&
        !data.sources.some(
          (item) => item.id === fact.sourceId && item.kind === "regulator",
        ),
    );
    return (
      matches.find((fact) =>
        data.sources.some(
          (item) => item.id === fact.sourceId && item.kind === "provider",
        ),
      ) ??
      matches[0] ??
      []
    );
  });
  if (!facts.length)
    return <p className={styles.muted}>No everyday details published.</p>;
  return facts.slice(0, 1).map((fact) => (
    <div className={styles.fact} key={fact.id}>
      <p>
        {fact.text.length > 90
          ? `${fact.text.slice(0, 90).replace(/\s+\S*$/, "")}…`
          : fact.text}
      </p>
      <Source
        source={data.sources.find((item) => item.id === fact.sourceId)}
        compact
      />
      {/extra|additional|not included/i.test(fact.text) && (
        <small>Some services may cost extra.</small>
      )}
      {(fact.text.length > 90 || facts.length > 1) && (
        <details className={styles.more}>
          <summary>Perks & details</summary>
          {facts.map((detail) => (
            <div className={styles.fact} key={detail.id}>
              <p>{detail.text}</p>
              <Source
                source={data.sources.find(
                  (item) => item.id === detail.sourceId,
                )}
              />
            </div>
          ))}
        </details>
      )}
    </div>
  ));
}

function Review({ data }: { data: LocationResearchResponse }) {
  const insight = reviewInsight(data);
  if (!insight)
    return <p className={styles.muted}>No firsthand account found.</p>;
  const excerpt =
    insight.text.length > 120
      ? `${insight.text.slice(0, 120).replace(/\s+\S*$/, "")}…`
      : insight.text;
  return (
    <>
      {insight.quoted ? <blockquote>“{excerpt}”</blockquote> : <p>{excerpt}</p>}
      <small className={styles.source}>
        {insight.url ? (
          <a href={insight.url} target="_blank" rel="noreferrer">
            {insight.attribution}
          </a>
        ) : (
          insight.attribution
        )}
        {" · "}
        {evidenceDate(insight.date)}
      </small>
      <small className={styles.muted}>
        One selected account, not a survey. Relationship unverified.
      </small>
      {data.experience.selectedConcerns && (
        <small>Selected reviews also include concerns.</small>
      )}
      {insight.limitations
        .filter((limitation) =>
          /search preview|separate care unit/i.test(limitation),
        )
        .map((limitation) => (
          <small key={limitation}>{limitation}</small>
        ))}
      {(excerpt !== insight.text || insight.limitations.length > 0) && (
        <details className={styles.more}>
          <summary>Full account & context</summary>
          {excerpt !== insight.text && <p>{insight.text}</p>}
          {insight.limitations.map((limitation, index) => (
            <p key={index}>{limitation}</p>
          ))}
        </details>
      )}
    </>
  );
}

function ProviderFacts({
  provider,
  column,
}: {
  provider: Provider;
  column: number;
}) {
  const { data, error, loading, retry } =
    useProviderEvidence<LocationResearchResponse>(provider.id, source);
  const values = data
    ? [
        <Prices key="prices" data={data} />,
        <Perks key="perks" data={data} />,
        <Review key="review" data={data} />,
      ]
    : [];
  return rows.map((label, index) => (
    <div
      key={label}
      className={styles.cell}
      role="group"
      style={{ gridColumn: column, gridRow: index * 2 + 2 }}
      aria-label={`${provider.name}, ${label.toLowerCase()}`}
      aria-busy={loading}
    >
      {loading ? (
        <p className={styles.muted} role={index === 0 ? "status" : undefined}>
          Loading…
        </p>
      ) : error ? (
        index === 0 ? (
          <div role="alert">
            <p>{error}</p>
            <button
              className={styles.retry}
              onClick={retry}
              aria-label={`Retry details for ${provider.name}`}
            >
              Try again
            </button>
          </div>
        ) : (
          <p className={styles.muted}>Details unavailable.</p>
        )
      ) : (
        values[index]
      )}
    </div>
  ));
}

export function ComparePlaceFacts({
  providers,
}: {
  providers: readonly Provider[];
}) {
  if (!providers.length) return null;
  return (
    <section
      className={styles.grid}
      aria-label="Prices, everyday perks and review insights"
      style={{
        gridTemplateColumns: `repeat(${providers.length}, minmax(0, 1fr))`,
        minWidth: `calc(${providers.length} * var(--compare-column-width, 140px))`,
      }}
    >
      {rows.map((label, index) => (
        <h3
          key={label}
          className={styles.band}
          style={{ gridRow: index * 2 + 1 }}
        >
          {label}
        </h3>
      ))}
      {providers.map((provider, index) => (
        <ProviderFacts
          key={provider.id}
          provider={provider}
          column={index + 1}
        />
      ))}
    </section>
  );
}
