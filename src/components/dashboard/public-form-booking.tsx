import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ELDERLY_SAVIOR_PROVIDER_ID,
  publicFormProvider,
  publicFormRebookable,
  type PublicFormProvider,
} from "@/lib/public-form-providers";
import styles from "./home-care-outreach/home-care-outreach.module.css";

export { ELDERLY_SAVIOR_PROVIDER_ID } from "@/lib/public-form-providers";
const endpoint = "/api/public-form-bookings";
const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const messages = {
  queued_booking:
    "Harbor received your approval. You can close this page and return here for the result.",
  booking: "Harbor is checking for an opening within your window.",
  submitting:
    "Harbor is submitting your booking. Check here for the agency’s response.",
  confirmed: "Scheduled",
  pending: "Waiting for agency confirmation",
  unknown: "Waiting for agency confirmation",
  unavailable:
    "The agency could not offer a consultation within your window. Choose another window.",
  needs_human:
    "The agency needs a person to continue. Check with the office before starting another booking.",
  failed:
    "Harbor could not complete this request. Check the agency calendar or try another window.",
};
type Job = {
  id: string;
  status: keyof typeof messages;
  windowStart: string;
  windowEnd: string;
  startTime: string | null;
  receipt: string | null;
};
const processing = new Set<Job["status"]>([
  "queued_booking",
  "booking",
  "submitting",
]);
const minute = 60000;
type Defaults = {
  name: string;
  phone: string;
  windowStart: string;
  windowEnd: string;
};
function validContact(name: string, phone: string) {
  return (
    name.length <= 100 &&
    /\S+\s+\S+/.test(name.trim()) &&
    phone.length <= 24 &&
    /^(?:\+?1)?[2-9]\d{9}$/.test(phone.replace(/[- ().]/g, ""))
  );
}
function validWindow(from: number, to: number, now: number) {
  return (
    from > now &&
    to - from >= 30 * minute &&
    to - from <= 7 * 1440 * minute &&
    to <= now + 31 * 1440 * minute
  );
}
function localTime(instant: string) {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * minute)
    .toISOString()
    .slice(0, 16);
}
function reusableDefaults(
  value: unknown,
  job: Job | null,
  office: PublicFormProvider,
): Defaults | null {
  if (
    !job ||
    !publicFormRebookable(job, office, Date.now()) ||
    !value ||
    typeof value !== "object"
  )
    return null;
  const fields = value as Record<string, unknown>;
  const { name, phone, windowStart, windowEnd } = fields;
  if (
    typeof name !== "string" ||
    typeof phone !== "string" ||
    typeof windowStart !== "string" ||
    typeof windowEnd !== "string" ||
    !validContact(name, phone)
  )
    return null;
  return { name, phone, windowStart, windowEnd };
}
function localInstant(value: string): number {
  const d = new Date(value);
  // A nonexistent local time during spring-forward must never roll into another hour silently.
  if (!Number.isFinite(d.getTime())) return NaN;
  const wallTime = new Date(d.getTime() - d.getTimezoneOffset() * minute)
    .toISOString()
    .slice(0, 16);
  return wallTime === value ? d.getTime() : NaN;
}
async function readResult(
  response: Response,
  email: string,
): Promise<{ job: Job | null; defaults?: unknown }> {
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Harbor could not load your booking.");
  if (result.email !== email)
    throw new Error(
      "The signed-in account changed. Reload Harbor to continue.",
    );
  return result;
}

const readTime = () => Date.now();

export function PublicFormBooking({
  providerId = ELDERLY_SAVIOR_PROVIDER_ID,
  email,
  historyOnly = false,
  onViewPlan,
}: {
  providerId?: string;
  email: string;
  historyOnly?: boolean;
  onViewPlan?: () => void;
}) {
  const office = publicFormProvider(providerId);
  if (!office) return null;
  return (
    <OfficeBooking
      key={`${providerId}:${email}:${historyOnly}`}
      office={office}
      email={email}
      historyOnly={historyOnly}
      onViewPlan={onViewPlan}
    />
  );
}

function OfficeBooking({
  office,
  email,
  historyOnly,
  onViewPlan,
}: {
  office: PublicFormProvider;
  email: string;
  historyOnly: boolean;
  onViewPlan?: () => void;
}) {
  const { providerId } = office;
  const [job, setJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [reused, setReused] = useState(false);
  const setupRead = useRef(false);
  const pendingWrite = useRef<AbortController | null>(null);
  const attempt = useRef<{ instruction: string; id: string } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const setup = !historyOnly && !setupRead.current;
        const response = await fetch(
          endpoint +
            "?" +
            new URLSearchParams({
              providerId,
              ...(setup ? { prefill: "1" } : {}),
            }),
          {
            signal: abort.signal,
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
          },
        );
        const result = await readResult(response, email);
        if (abort.signal.aborted) return;
        const current = result.job;
        if (setup) {
          setupRead.current = true;
          const defaults = reusableDefaults(result.defaults, current, office);
          if (defaults) {
            setName(defaults.name);
            setPhone(defaults.phone);
            if (
              validWindow(
                Date.parse(defaults.windowStart),
                Date.parse(defaults.windowEnd),
                readTime(),
              )
            ) {
              setStart(localTime(defaults.windowStart));
              setEnd(localTime(defaults.windowEnd));
              setReused(true);
            }
          }
          setConsent(false);
        }
        setJob(current);
        setLoaded(true);
        setError("");
        if (current && processing.has(current.status))
          timer = setTimeout(refresh, 3500);
      } catch (failure) {
        if (abort.signal.aborted) return;
        setLoaded(false);
        setJob(null);
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not check booking status.",
        );
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [email, providerId, revision, historyOnly, office]);
  useEffect(() => () => pendingWrite.current?.abort(), []);

  const from = localInstant(start),
    to = localInstant(end);
  const [now, setNow] = useState(readTime);
  const windowIsValid = validWindow(from, to, now);
  const canBook = loaded && publicFormRebookable(job, office, now);
  useEffect(() => {
    if (!Number.isFinite(from) || from <= readTime()) return;
    const timer = setTimeout(
      () => {
        setNow(readTime());
        setConsent(false);
      },
      Math.min(from - readTime() + 1, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [from, now]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !canBook ||
      !publicFormRebookable(job, office, readTime()) ||
      !validWindow(from, to, readTime()) ||
      !validContact(name, phone) ||
      !consent ||
      pendingWrite.current
    ) {
      setNow(readTime());
      setConsent(false);
      return;
    }
    const fields = {
      action: "bookWindow",
      providerId,
      windowStart: new Date(from).toISOString(),
      windowEnd: new Date(to).toISOString(),
      name: name.trim(),
      phone: phone.trim(),
      expectedEmail: email,
      consentVersion: office.consentVersion,
    };
    const instruction = JSON.stringify(fields);
    if (attempt.current?.instruction !== instruction)
      attempt.current = { instruction, id: crypto.randomUUID() };
    const abort = new AbortController();
    pendingWrite.current = abort;
    setError("");
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: abort.signal,
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, requestId: attempt.current.id }),
      });
      const { job: current } = await readResult(response, email);
      if (abort.signal.aborted) return;
      if (!current) throw new Error("Check booking status before continuing.");
      setJob(current);
      attempt.current = null;
      setConsent(false);
      setName("");
      setPhone("");
      setRevision((n) => n + 1);
      onViewPlan?.();
    } catch (failure) {
      if (abort.signal.aborted) return;
      // A lost response can follow a committed approval. Check the stored job before enabling another action.
      setLoaded(false);
      setJob(null);
      setConsent(false);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not verify the result. Check booking status.",
      );
    } finally {
      pendingWrite.current = null;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  if (historyOnly && !job && !error) return null;
  return (
    <section
      className={styles.booking}
      aria-label={`${office.shortName} reach out`}
    >
      {historyOnly && <h2>Latest {office.shortName} consultation</h2>}
      <p>
        {office.agencyName} · {office.serviceTitle}
      </p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Check booking status
          </button>
        </>
      )}
      {!loaded && !error && <p role="status">Loading booking status…</p>}
      {loaded && job && (historyOnly || !canBook) && (
        <>
          <p role="status">
            <strong>{messages[job.status]}</strong>
          </p>
          {job.status === "unknown" && (
            <p>
              Check your invitation email or contact the office before
              requesting another appointment.
            </p>
          )}
          {job.startTime && (
            <p>
              {job.status === "confirmed" ? "Scheduled time" : "Intended start"}{" "}
              · {easternTime.format(new Date(job.startTime))}
            </p>
          )}
          <p>
            Intended window ·{" "}
            {easternTime.formatRange(
              new Date(job.windowStart),
              new Date(job.windowEnd),
            )}
          </p>
          {job.receipt && (
            <details>
              <summary>Submission details & receipt</summary>
              <p>{job.receipt}</p>
            </details>
          )}
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Refresh status
          </button>
          {!historyOnly && onViewPlan && (
            <button
              className="button button-primary"
              type="button"
              onClick={onViewPlan}
            >
              Go to Your plan
            </button>
          )}
        </>
      )}
      {!historyOnly && canBook && (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend>
              {reused ? "Review your request" : "Set up your request"}
            </legend>
            <p>
              {reused
                ? "Details from your previous request. Review them before approving."
                : "Add your contact details and a time window. Harbor can book one opening entirely within it."}
            </p>
            {reused && (
              <div>
                <p>
                  {name} · {phone}
                </p>
                {windowIsValid && (
                  <p>
                    Intended window ·{" "}
                    {easternTime.formatRange(new Date(from), new Date(to))}
                  </p>
                )}
                {!windowIsValid && (
                  <p role="status">
                    Your time window has expired. Choose a future window.
                  </p>
                )}
              </div>
            )}
            <p>Invitation email · {email}</p>
            <details open={reused ? undefined : true}>
              <summary>Edit contact details & time</summary>
              <small>
                Enter times in{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Choose 30
                minutes to 7 days within the next 31 days.
              </small>
              <label>
                Earliest start
                <input
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setConsent(false);
                  }}
                />
              </label>
              <label>
                Latest finish
                <input
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setConsent(false);
                  }}
                />
              </label>
              {start && end && (
                <p role="status">
                  {windowIsValid
                    ? "New Jersey time · " +
                      easternTime.formatRange(new Date(from), new Date(to))
                    : "Choose a future window of 30 minutes to 7 days within the next 31 days."}
                </p>
              )}
              <label>
                Full name
                <input
                  placeholder="First and last name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setConsent(false);
                  }}
                />
              </label>
              <label>
                US phone number
                <input
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength={24}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setConsent(false);
                  }}
                />
              </label>
            </details>
            <label>
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              {office.consent}
            </label>
            {office.consentNote && <small>{office.consentNote}</small>}
            <button
              className="button button-primary"
              type="submit"
              disabled={
                !consent || !windowIsValid || !validContact(name, phone)
              }
            >
              {busy ? "Sending approval…" : "Approve reach out"}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
