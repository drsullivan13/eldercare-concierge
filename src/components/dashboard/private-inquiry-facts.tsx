import { useEffect, useRef, useState } from "react";
import {
  parseInquiryFact,
  summarizeInquiryFacts,
  type InquiryFact,
} from "@/lib/inquiry-facts";
import styles from "./outreach.module.css";

const labels = {
  coverage_zip: "Office ZIP coverage",
  hourly_rate: "Hourly quote (USD/hour)",
  minimum_hours: "Minimum hours",
  earliest_start: "Earliest start date",
};
const path = "/api/inquiry-facts";

function isFact(
  value: unknown,
  requestId: string,
  providerId: string,
): value is InquiryFact {
  const fact = parseInquiryFact(value);
  return (
    fact !== null &&
    fact.requestId === requestId &&
    fact.providerId === providerId
  );
}

export function PrivateInquiryFacts(props: {
  requestId: string;
  providerId: string;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>Private office facts for this request</summary>
      {opened && (
        <FactsEditor key={props.requestId + props.providerId} {...props} />
      )}
    </details>
  );
}

function FactsEditor({
  requestId,
  providerId,
}: {
  requestId: string;
  providerId: string;
}) {
  const [facts, setFacts] = useState<InquiryFact[]>([]);
  const [owner, setOwner] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [zip, setZip] = useState("");
  const [kind, setKind] = useState<InquiryFact["kind"]>("coverage_zip");
  const [value, setValue] = useState("serves");
  const [unknown, setUnknown] = useState(false);
  const [checkedOn, setCheckedOn] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState("");
  const pending = useRef<{ expectedOwner: string; fact: InquiryFact } | null>(
    null,
  );
  const saving = useRef(false);
  const initialOwner = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setOwner("");
      setError("");
      try {
        const response = await fetch(
          `${path}?${new URLSearchParams({ requestId })}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (
          !response.ok ||
          typeof data.owner !== "string" ||
          !Array.isArray(data.facts) ||
          data.facts.length > 200 ||
          !data.facts.every((fact: unknown) =>
            isFact(fact, requestId, providerId),
          )
        )
          throw new Error();
        if (!controller.signal.aborted) {
          if (initialOwner.current && initialOwner.current !== data.owner) {
            setError(
              "The signed-in account changed. Reload this page before saving. Your draft is retained.",
            );
            return;
          }
          initialOwner.current = data.owner;
          setFacts(data.facts);
          setOwner(data.owner);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(
            "Could not load private facts. Your draft is retained. Retry loading before saving.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [requestId, providerId, revision]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !owner || loading) return;
    const fact: InquiryFact = {
      id: "",
      requestId,
      providerId,
      careZip: zip,
      kind,
      value: unknown ? null : value,
      checkedOn,
      validUntil: validUntil || null,
      source: "family_reported_office_response",
    };
    const fingerprint = JSON.stringify({ ...fact, id: "" });
    if (
      !pending.current ||
      JSON.stringify({ ...pending.current.fact, id: "" }) !== fingerprint
    )
      pending.current = {
        expectedOwner: owner,
        fact: { ...fact, id: crypto.randomUUID() },
      };
    const attempt = pending.current;
    if (attempt.expectedOwner !== owner) {
      setError(
        "The signed-in account changed. Reload this page before saving. Your draft is retained.",
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        body: JSON.stringify(attempt),
      });
      if ([401, 403, 409].includes(response.status)) {
        setOwner("");
        throw new Error(
          "The account or saved record changed. Reload this page before saving. Your draft is retained.",
        );
      }
      const data = await response.json();
      if (response.ok && data?.owner !== attempt.expectedOwner) {
        setOwner("");
        throw new Error(
          "Could not verify the signed-in account. Refresh private facts before saving. Your draft is retained.",
        );
      }
      if (
        !response.ok ||
        !isFact(data.fact, requestId, providerId) ||
        Object.entries(attempt.fact).some(
          ([key, value]) => data.fact[key] !== value,
        ) ||
        typeof data.replayed !== "boolean"
      )
        throw new Error(
          "Could not confirm the save. Your draft is retained; retry the same fact safely.",
        );
      setFacts((current) =>
        current.some((row) => row.id === data.fact.id)
          ? current
          : [...current, data.fact],
      );
      pending.current = null;
      setNotice(
        "Private fact saved. Record another response only if its details changed.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save. Your draft is retained; retry safely.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const matching = owner ? facts.filter((fact) => fact.careZip === zip) : [];
  return (
    <div className={styles.editor}>
      <p className="small muted">
        Private to your account. Family-reported office responses only; these do
        not verify availability, arrange care, or change public scores. Keep
        names, medical details and transcripts out.
      </p>
      {loading && <p role="status">Loading private facts…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className={styles.editor} onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} className={styles.factFields}>
          <label className={styles.familyField}>
            Care ZIP
            <input
              required
              pattern="[0-9]{5}"
              maxLength={5}
              inputMode="numeric"
              value={zip}
              onChange={(event) => {
                setZip(event.target.value);
                setNotice("");
              }}
            />
          </label>
          <label className={styles.familyField}>
            Fact type
            <select
              value={kind}
              onChange={(event) => {
                const next = event.target.value as InquiryFact["kind"];
                setKind(next);
                setValue(next === "coverage_zip" ? "serves" : "");
                setNotice("");
              }}
            >
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={unknown}
              onChange={(event) => {
                setUnknown(event.target.checked);
                setNotice("");
              }}
            />{" "}
            Response is unknown
          </label>
          {!unknown && (
            <label className={styles.familyField}>
              {labels[kind]}
              {kind === "coverage_zip" ? (
                <select
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setNotice("");
                  }}
                >
                  <option value="serves">Office says it serves this ZIP</option>
                  <option value="does_not_serve">
                    Office says it does not serve this ZIP
                  </option>
                </select>
              ) : (
                <input
                  required
                  type={kind === "earliest_start" ? "date" : "number"}
                  min={kind === "earliest_start" ? undefined : 0}
                  max={
                    kind === "hourly_rate"
                      ? 10000
                      : kind === "minimum_hours"
                        ? 168
                        : undefined
                  }
                  step="0.01"
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setNotice("");
                  }}
                />
              )}
            </label>
          )}
          <label className={styles.familyField}>
            Office response checked on
            <input
              required
              type="date"
              max={today}
              value={checkedOn}
              onChange={(event) => {
                setCheckedOn(event.target.value);
                setNotice("");
              }}
            />
          </label>
          <label className={styles.familyField}>
            Valid through (optional)
            <input
              type="date"
              min={checkedOn}
              value={validUntil}
              onChange={(event) => {
                setValidUntil(event.target.value);
                setNotice("");
              }}
            />
          </label>
          <p className="small muted">
            Source: family-reported office response. Saving adds history;
            earlier responses remain.
          </p>
          <button
            className="button button-outline"
            disabled={loading || !owner || Boolean(notice)}
            type="submit"
          >
            {busy ? "Saving private fact…" : "Save private fact"}
          </button>
        </fieldset>
      </form>
      <button
        type="button"
        className="text-link"
        disabled={loading || busy}
        onClick={() => setRevision((current) => current + 1)}
      >
        Refresh private facts
      </button>
      <h4>Evidence for {/^\d{5}$/.test(zip) ? zip : "a care ZIP"}</h4>
      {owner && !matching.length && (
        <p>No private responses recorded for this ZIP.</p>
      )}
      {summarizeInquiryFacts(matching, today).map(
        ({ kind: key, status, facts: rows }) => {
          if (!rows.length) return null;
          const label = labels[key];
          return (
            <div key={key}>
              <h4>
                {label} ·{" "}
                {status === "conflicting"
                  ? "Conflicting reports — check with office"
                  : status === "reported"
                    ? "Family reported"
                    : status === "stale"
                      ? "Expired — check again"
                      : "Unknown — check with office"}
              </h4>
              <ul>
                {rows.map((fact) => (
                  <li key={fact.id}>
                    {fact.value === null
                      ? "Unknown"
                      : fact.kind === "coverage_zip"
                        ? fact.value === "serves"
                          ? "Serves this ZIP"
                          : "Does not serve this ZIP"
                        : fact.kind === "hourly_rate"
                          ? `$${fact.value}/hour`
                          : fact.kind === "minimum_hours"
                            ? `${fact.value} hours`
                            : fact.value}{" "}
                    · checked {fact.checkedOn} ·{" "}
                    {fact.validUntil
                      ? `valid through ${fact.validUntil}${fact.validUntil < today ? " (expired)" : ""}`
                      : "no expiry supplied; recheck with office"}{" "}
                    · family-reported office response
                  </li>
                ))}
              </ul>
            </div>
          );
        },
      )}
    </div>
  );
}
