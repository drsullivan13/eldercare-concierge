import { useEffect, useRef, useState, type FormEvent } from "react";

export const ELDERLY_SAVIOR_PROVIDER_ID = "north-jersey-hp-hp0265900";
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
  confirmed: "The agency confirmed your consultation.",
  pending: "The agency received your request. Office confirmation is pending.",
  unknown:
    "The outcome is unclear. Check your email or contact the office before requesting another appointment.",
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
): Promise<Job | null> {
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Harbor could not load your booking.");
  if (result.email !== email)
    throw new Error(
      "The signed-in account changed. Reload Harbor to continue.",
    );
  return result.job;
}

export function PublicFormBooking({
  email,
  historyOnly = false,
}: {
  email: string;
  historyOnly?: boolean;
}) {
  const providerId = ELDERLY_SAVIOR_PROVIDER_ID;
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
  const pendingWrite = useRef<AbortController | null>(null);
  const attempt = useRef<{ instruction: string; id: string } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(
          endpoint + "?" + new URLSearchParams({ providerId }),
          {
            signal: abort.signal,
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
          },
        );
        const current = await readResult(response, email);
        if (abort.signal.aborted) return;
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
  }, [email, providerId, revision]);
  useEffect(() => () => pendingWrite.current?.abort(), []);

  const from = localInstant(start),
    to = localInstant(end);
  const [now] = useState(Date.now);
  const validWindow =
    from > now &&
    to - from >= 30 * minute &&
    to - from <= 7 * 1440 * minute &&
    to <= now + 31 * 1440 * minute;
  const canBook =
    loaded &&
    (!job ||
      job.status === "failed" ||
      job.status === "unavailable" ||
      (job.status === "confirmed" &&
        job.startTime !== null &&
        new Date(job.startTime).getTime() + 30 * minute <= now));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canBook || !validWindow || !consent || pendingWrite.current) return;
    const fields = {
      action: "bookWindow",
      providerId,
      windowStart: new Date(from).toISOString(),
      windowEnd: new Date(to).toISOString(),
      name: name.trim(),
      phone: phone.trim(),
      expectedEmail: email,
      consentVersion: "elderly-savior-v1",
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
      const current = await readResult(response, email);
      if (abort.signal.aborted) return;
      if (!current) throw new Error("Check booking status before continuing.");
      setJob(current);
      attempt.current = null;
      setConsent(false);
      setName("");
      setPhone("");
      setRevision((n) => n + 1);
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
    <>
      {historyOnly && <h2>Latest Elderly Savior consultation</h2>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Check booking status
          </button>
        </>
      )}
      {!loaded && !error && <p role="status">Loading booking status…</p>}
      {loaded && job && (
        <>
          <p role="status">{messages[job.status]}</p>
          <p>
            Approved window ·{" "}
            {easternTime.formatRange(
              new Date(job.windowStart),
              new Date(job.windowEnd),
            )}
          </p>
          {job.startTime && job.status === "confirmed" && (
            <p>Appointment · {easternTime.format(new Date(job.startTime))}</p>
          )}
          {job.receipt && ["confirmed", "pending"].includes(job.status) && (
            <p>Agency receipt · {job.receipt}</p>
          )}
        </>
      )}
      {!historyOnly && canBook && (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend>Free 30-minute Google Meet consultation</legend>
            <p>
              Choose a window. Harbor can book one opening that fits entirely
              inside it.
            </p>
            <small>
              Enter times in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
              Choose 30 minutes to 7 days within the next 31 days.
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
                {validWindow
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
                placeholder="(201) 555-0123"
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
            <p>Invitation email · {email}</p>
            <label>
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              I authorize Harbor to book one consultation in this window and
              share my name, email and phone with Elderly Savior Homecare LLC. I
              agree to phone calls, texts or emails about home care,
              appointments, referrals and related marketing, including automated
              or prerecorded calls and AI voice. Message and data rates may
              apply.
            </label>
            <small>
              Consent is optional for purchasing services. Opt out by replying
              STOP, asking the office to stop calling, or calling (973)
              855-4461. Harbor leaves the separate promotional-text opt-in
              unchecked.
            </small>
            <button
              className="button button-primary"
              type="submit"
              disabled={
                !consent ||
                !validWindow ||
                !/\S+\s+\S+/.test(name.trim()) ||
                !/^(?:\+?1)?[2-9]\d{9}$/.test(phone.replace(/[- ().]/g, ""))
              }
            >
              Book for me
            </button>
          </fieldset>
        </form>
      )}
    </>
  );
}
