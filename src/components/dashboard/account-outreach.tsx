import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./outreach.module.css";
import { FamilyFollowups } from "./family-followups";
import { LinkedConsultations } from "./linked-consultations";
import { RehearsalReports } from "./rehearsal-reports";

const requestsPath = "/api/outreach-requests";
const handoffPath = "/api/outreach-handoff";
const rehearsalUrl = "https://harbor-voice-lab.vercel.app/rehearsal.html";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const accountOutreachUnavailable =
  "Account voice rehearsal is temporarily unavailable.";

export type AccountOutreachBrief = {
  scenarioId: string;
  topics: string[];
  timing: string;
  situation: string;
  question: string;
  careZip?: string;
};

type RequestSummary = {
  requestId: string;
  providerId: string;
  providerName: string | null;
  status: "requested";
  createdAt: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSummary(value: unknown): value is RequestSummary {
  return (
    isObject(value) &&
    typeof value.requestId === "string" &&
    uuid.test(value.requestId) &&
    typeof value.providerId === "string" &&
    value.providerId.length > 0 &&
    (typeof value.providerName === "string" || value.providerName === null) &&
    value.status === "requested" &&
    isDate(value.createdAt)
  );
}

async function post(path: string, body: object, signal: AbortSignal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    body: JSON.stringify(body),
    signal,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Sign in to open an outreach rehearsal.");
    if (path === handoffPath && response.status === 403)
      throw new Error(
        "Verify your account email to open an outreach rehearsal.",
      );
    throw new Error(
      path === requestsPath
        ? "Could not save the outreach request. Please retry."
        : "Could not open the rehearsal. Please retry.",
    );
  }
  return data;
}

export function useAccountRehearsal() {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => () => pending.current?.abort(), []);

  async function open(
    requestId: string,
    draft?: { providerId: string; brief: AccountOutreachBrief },
  ) {
    if (pending.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      if (draft) {
        const receipt = await post(
          requestsPath,
          { requestId, ...draft },
          signal,
        );
        if (
          !isObject(receipt) ||
          receipt.requestId !== requestId ||
          receipt.providerId !== draft.providerId ||
          receipt.status !== "requested" ||
          !isDate(receipt.createdAt) ||
          typeof receipt.replayed !== "boolean"
        )
          throw new Error(
            "Could not confirm the outreach request. Please retry.",
          );
      }
      if (signal.aborted) return;
      const handoff = await post(handoffPath, { requestId }, signal);
      if (
        !isObject(handoff) ||
        typeof handoff.token !== "string" ||
        !/^[0-9a-f]{64}$/.test(handoff.token) ||
        !isDate(handoff.expiresAt)
      )
        throw new Error("Could not confirm the rehearsal link. Please retry.");
      if (signal.aborted) return;
      window.location.assign(rehearsalUrl + `#handoff=${handoff.token}`);
    } catch (failure) {
      if (!signal.aborted)
        setError(
          failure instanceof Error && failure.name === "Error"
            ? failure.message
            : "Could not open the rehearsal. Check your connection and retry.",
        );
    } finally {
      pending.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }
  return { open, busy, error };
}

export function AccountOutreachHistory({
  available,
  email = "",
}: {
  available: boolean;
  email?: string;
}) {
  const heading = useId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    requests: RequestSummary[];
    error?: string;
  }>();
  const rehearsal = useAccountRehearsal();
  const refreshing = result?.revision !== revision;
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const response = await fetch(requestsPath, {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal,
        });
        if (!response.ok) throw new Error();
        const data: unknown = await response.json();
        if (
          !isObject(data) ||
          !Array.isArray(data.requests) ||
          !data.requests.every(isSummary)
        )
          throw new Error();
        if (!signal.aborted) setResult({ revision, requests: data.requests });
      } catch {
        if (!signal.aborted)
          setResult({
            revision,
            requests: [],
            error: "Could not load account outreach requests. Please retry.",
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  return (
    <>
      <FamilyFollowups requests={result?.requests ?? []} />
      <section className={styles.history} aria-labelledby={heading}>
        <div className={styles.heading}>
          <div>
            <h2 id={heading}>Account outreach requests</h2>
            <p className="small muted">
              Practice requests saved to your account.
            </p>
          </div>
          <button
            type="button"
            className="button button-outline"
            disabled={refreshing || rehearsal.busy}
            onClick={() => setRevision((current) => current + 1)}
          >
            Refresh account requests
          </button>
        </div>
        {refreshing && <p role="status">Loading account outreach requests…</p>}
        {rehearsal.busy && <p role="status">Opening rehearsal…</p>}
        {!refreshing && result?.error && (
          <p className="form-error" role="alert">
            {result.error}
          </p>
        )}
        {rehearsal.error && (
          <p className="form-error" role="alert">
            {rehearsal.error}
          </p>
        )}
        {!refreshing && !result?.error && result?.requests.length === 0 && (
          <p>No account outreach requests yet.</p>
        )}
        {!available && Boolean(result?.requests.length) && (
          <p className="small muted">{accountOutreachUnavailable}</p>
        )}
        {result?.requests.map(
          ({ providerId, providerName, requestId, createdAt }) => (
            <article className={styles.entry} key={requestId}>
              <header>
                <h3>{providerName || providerId}</h3>
                <p>
                  Requested{" "}
                  <time dateTime={createdAt}>
                    {new Date(createdAt).toLocaleDateString()}
                  </time>
                </p>
              </header>
              <RehearsalReports
                requestId={requestId}
                revision={result.revision}
              />
              <LinkedConsultations
                key={`${requestId}:${result.revision}`}
                requestId={requestId}
                providerId={providerId}
                email={email}
              />
              {available && (
                <button
                  type="button"
                  className="button button-outline"
                  disabled={refreshing || rehearsal.busy}
                  onClick={() => void rehearsal.open(requestId)}
                >
                  Reopen rehearsal
                </button>
              )}
            </article>
          ),
        )}
      </section>
    </>
  );
}
