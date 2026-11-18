import { useEffect, useId, useRef, useState } from "react";
import styles from "./outreach.module.css";
import formStyles from "./family-followups.module.css";

type Followup = {
  followupId: string;
  requestId: string;
  kind: "promised_callback" | "next_action";
  assignee: string;
  note: string;
  dueAt: string | null;
  source: string;
  channel: string;
  status: "open" | "done";
};
const path = "/api/outreach-followups";

export function FamilyFollowups({
  requests,
}: {
  requests: {
    requestId: string;
    providerName: string | null;
    providerId: string;
  }[];
}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ items: Followup[]; now: number }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const retry = useRef<{ fingerprint: string; body: object } | null>(null);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setRevision((value) => value + 1);
    };
    window.addEventListener("pageshow", restore);
    return () => {
      mutation.current?.abort();
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(path, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (
          !Array.isArray(data.followups) ||
          !Number.isFinite(Date.parse(data.serverNow)) ||
          !data.followups.every(
            (item: Followup) =>
              item &&
              typeof item.followupId === "string" &&
              typeof item.requestId === "string" &&
              typeof item.note === "string" &&
              ["open", "done"].includes(item.status) &&
              (item.dueAt === null || Number.isFinite(Date.parse(item.dueAt))),
          )
        )
          throw new Error();
        if (!controller.signal.aborted) {
          setResult({ items: data.followups, now: Date.parse(data.serverNow) });
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Could not load family follow-ups. Retry to see current tasks.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  async function write(
    method: "POST" | "PATCH",
    body: object,
    form?: HTMLFormElement,
  ) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        redirect: "error",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 503
            ? "Follow-up saving is temporarily unavailable. Your details are retained; retry later."
            : "Could not save the follow-up. Retry with the same details.",
        );
      if (!controller.signal.aborted) {
        if (form) {
          form.reset();
          retry.current = null;
        }
        setRevision((value) => value + 1);
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not save. Retry with the same details.",
        );
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const items = [...(result?.items ?? [])].sort(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
        (b.dueAt ? Date.parse(b.dueAt) : Infinity),
  );
  return (
    <section className={styles.history} aria-labelledby={id}>
      <h2 id={id}>Family follow-ups</h2>
      <p>
        Record what you heard by phone or email, or your own next action. These
        are family reports, not office confirmations or appointments. No message
        is sent.
      </p>
      <p className="small muted">
        Due dates use {timezone}. Showing up to 100 follow-ups, with open and
        earliest due first.
      </p>
      <button
        className="button button-outline"
        disabled={loading || busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        Refresh family follow-ups
      </button>
      {loading && <p role="status">Loading family follow-ups…</p>}
      {busy && <p role="status">Saving family follow-up…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && result && items.length === 0 && (
        <p>No family follow-ups recorded yet.</p>
      )}
      {items.map((item) => (
        <article key={item.followupId} className={styles.entry}>
          <h3>
            {item.kind === "promised_callback"
              ? "Reported callback promise"
              : "Next action"}
          </h3>
          <p>
            {requests.find((request) => request.requestId === item.requestId)
              ?.providerName || "Outreach request"}
          </p>
          <p>{item.note}</p>
          <p>
            Assigned to: {item.assignee} · Channel: {item.channel} ·{" "}
            {item.source === "user_reported"
              ? "Family reported"
              : "Service evidence"}
          </p>
          <p>
            {item.status === "done"
              ? "Marked done by family"
              : item.dueAt && Date.parse(item.dueAt) < (result?.now ?? 0)
                ? "Overdue"
                : item.dueAt
                  ? "Upcoming"
                  : "Due date unknown"}
            {item.dueAt && (
              <>
                {" "}
                ·{" "}
                <time dateTime={item.dueAt}>
                  {new Date(item.dueAt).toLocaleString(undefined, {
                    timeZoneName: "short",
                  })}
                </time>
              </>
            )}
          </p>
          {item.status === "open" && (
            <button
              className="button button-outline"
              disabled={busy || loading}
              onClick={() =>
                void write("PATCH", { followupId: item.followupId })
              }
            >
              Mark done: {item.note}
            </button>
          )}
        </article>
      ))}
      {requests.length > 0 && (
        <details>
          <summary className={formStyles.summary}>
            Record a family follow-up
          </summary>
          <form
            className={styles.editor}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const fields = new FormData(form);
              const local = String(fields.get("dueAt") || "");
              const details = {
                requestId: fields.get("requestId"),
                kind: fields.get("kind"),
                assignee: fields.get("assignee"),
                note: String(fields.get("note")).trim(),
                channel: fields.get("channel"),
                source: "user_reported",
                ...(local ? { dueAt: new Date(local).toISOString() } : {}),
              };
              const fingerprint = JSON.stringify(details);
              if (retry.current?.fingerprint !== fingerprint)
                retry.current = {
                  fingerprint,
                  body: { followupId: crypto.randomUUID(), ...details },
                };
              void write("POST", retry.current.body, form);
            }}
          >
            <fieldset disabled={busy || loading} className={formStyles.form}>
              <label>
                Outreach request
                <select name="requestId" required>
                  {requests.map((request) => (
                    <option key={request.requestId} value={request.requestId}>
                      {request.providerName || request.providerId} ·{" "}
                      {request.requestId.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select name="kind">
                  <option value="next_action">Next action</option>
                  <option value="promised_callback">
                    Reported callback promise
                  </option>
                </select>
              </label>
              <label>
                Assigned to
                <select name="assignee">
                  <option value="family">Family</option>
                  <option value="office">Office</option>
                  <option value="coordinator">Coordinator</option>
                </select>
              </label>
              <label>
                Channel
                <select name="channel">
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Short summary (no transcripts)
                <textarea name="note" required maxLength={500} />
              </label>
              <label>
                Due date and time (optional, {timezone})
                <input name="dueAt" type="datetime-local" />
              </label>
              <button className="button button-primary" type="submit">
                {busy ? "Saving…" : "Save family follow-up"}
              </button>
            </fieldset>
          </form>
        </details>
      )}
      {!requests.length && (
        <p>Save an account outreach request before recording a follow-up.</p>
      )}
    </section>
  );
}
