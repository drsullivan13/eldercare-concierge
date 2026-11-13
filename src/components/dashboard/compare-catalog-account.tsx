"use client";

import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import type {
  IndividualReview,
  IndividualReviewsResponse,
} from "@/lib/individual-reviews";
import type { Provider } from "@/lib/providers";
import { evidenceDate } from "../evidence-date";
import styles from "./compare-place-facts.module.css";

const source = {
  path: "/api/reviews",
  idParameter: "id",
  unavailable: "The individual review catalog could not be loaded.",
  mismatched: "The review catalog did not match this location.",
  fallback: "Individual reviews are unavailable.",
};

function accountText(account: IndividualReview) {
  if (account.representation === "link-only") return "";
  if (account.representation === "original-summary")
    return account.summary.trim();
  return account.excerpt.trim() || account.summary.trim();
}

function Account({ account }: { account: IndividualReview }) {
  const text = accountText(account);
  const quoted =
    account.representation !== "original-summary" &&
    Boolean(account.excerpt.trim());
  return (
    <article>
      {text ? (
        quoted ? (
          <blockquote>“{text}”</blockquote>
        ) : (
          <p>
            <strong>
              {account.representation === "original-summary"
                ? "Harbor summary"
                : "Research summary"}
            </strong>{" "}
            · {text}
          </p>
        )
      ) : (
        <p>Read this account at the source.</p>
      )}
      <small className={styles.source}>
        <a href={account.url} target="_blank" rel="noreferrer">
          {account.publisher}
        </a>
        {" · "}
        {account.relationship === "unknown"
          ? "Relationship unknown"
          : `Self-described ${account.relationship}`}
        {account.date && ` · ${evidenceDate(account.date)}`}
      </small>
      {account.providerSelected && (
        <small>Provider-selected testimonial.</small>
      )}
      {account.searchResultOnly && <small>Search preview only.</small>}
      {account.notes.length > 0 && (
        <details className={styles.more}>
          <summary>Account context</summary>
          {account.notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </details>
      )}
    </article>
  );
}

export default function CompareCatalogAccount({
  provider,
}: {
  provider: Provider;
}) {
  const { data, loading, error, retry } =
    useProviderEvidence<IndividualReviewsResponse>(provider.id, source);
  if (loading) return <p role="status">Loading review…</p>;
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button className={styles.retry} onClick={retry}>
          Retry individual reviews
        </button>
      </div>
    );

  const accounts = data?.accounts ?? [];
  const personal = accounts.filter(
    (account) => account.relationship !== "staff",
  );
  const selected = personal.find(accountText) ?? personal[0];
  const staff = accounts.filter((account) => account.relationship === "staff");
  const staffAccount = staff.find(accountText) ?? staff[0];
  return (
    <>
      {selected ? (
        <Account account={selected} />
      ) : (
        <p>No resident or family account is identified here.</p>
      )}
      {staffAccount && (
        <details className={styles.more}>
          <summary>Staff perspective</summary>
          <Account account={staffAccount} />
        </details>
      )}
    </>
  );
}
