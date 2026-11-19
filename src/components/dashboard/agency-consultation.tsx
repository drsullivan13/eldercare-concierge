import { useCallback, useEffect, useId, useRef, useState } from "react";
import { bookingMessage, type Consultation } from "@/lib/consultation-request";
import styles from "./home-care-outreach/home-care-outreach.module.css";
import {
  ELDERLY_SAVIOR_PROVIDER_ID,
  PublicFormBooking,
} from "./public-form-booking";
import { ConsultationVoice } from "./consultation-voice";

type Status = {
  configured: boolean;
  source: "phone" | "calendly" | "highlevel" | null;
  publicUrl?: string | null;
  phoneRequired: boolean;
  bookings: Consultation[];
};
async function load(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Couldn’t load bookings.");
  return data;
}
function BookingReceipt({ booking }: { booking: Consultation }) {
  const [delivery, setDelivery] = useState("");
  const confirmed =
    !booking.office_callback_pending && booking.status === "confirmed";
  const when = confirmed && booking.starts_at && booking.ends_at;
  const stamp = (v: string) =>
    new Date(v)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const google = when
    ? new URLSearchParams({
        action: "TEMPLATE",
        text: `Consultation with ${booking.agency_name}`,
        dates: `${stamp(booking.starts_at!)}/${stamp(booking.ends_at!)}`,
        ctz: booking.timezone,
      })
    : null;
  const harborInvite = booking.source !== "calendly" && confirmed;
  return (
    <div>
      <p>{bookingMessage(booking)}</p>
      {google && (
        <p>
          <a
            className="text-link"
            href={`https://calendar.google.com/calendar/render?${google}`}
            target="_blank"
            rel="noreferrer"
          >
            Add to Google Calendar
          </a>
        </p>
      )}
      {harborInvite && (
        <>
          <p>
            <a
              className="text-link"
              href={`/api/consultation-invites?bookingId=${encodeURIComponent(booking.id)}`}
            >
              Download calendar invitation
            </a>
          </p>
          {(booking.source === "phone" ||
            booking.invite_delivery === "harbor") && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await load("/api/consultation-invites", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ bookingId: booking.id }),
                  });
                  setDelivery(
                    (
                      {
                        accepted: "Invitation accepted for delivery.",
                        pending: "Invitation delivery is pending.",
                        review: "Invitation delivery is being checked.",
                        unconfigured:
                          "Use the calendar download to save your appointment.",
                      } as Record<string, string>
                    )[result.status] || "Check your email for the invitation.",
                  );
                } catch {
                  setDelivery(
                    "Couldn’t check the invitation. You can still download it.",
                  );
                }
              }}
            >
              Check email invitation
            </button>
          )}
          <p role="status">{delivery}</p>
        </>
      )}
    </div>
  );
}

export function ConsultationHistory() {
  const [rows, setRows] = useState<Consultation[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    load("/api/consultations", { signal: abort.signal })
      .then((d) => setRows(d.bookings))
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Consultation history couldn’t be loaded.");
      });
    return () => abort.abort();
  }, []);
  if (!rows.length && !error) return null;
  return (
    <section aria-label="Agency consultations">
      <h2>Agency consultations</h2>
      {error && <p role="status">{error}</p>}
      {rows.map((row) => (
        <article key={row.id}>
          <h3>{row.agency_name}</h3>
          <BookingReceipt booking={row} />
        </article>
      ))}
    </section>
  );
}

export function AgencyConsultation({
  providerId,
  email,
  outreachRequestId,
  onBooking,
}: {
  providerId: string;
  email: string;
  outreachRequestId?: string;
  onBooking?: () => void;
}) {
  const label = useId();
  const [state, setState] = useState<Status | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [openedAt] = useState(Date.now);
  const submitting = useRef(false);
  const requestId = useRef("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = "/api/consultations?providerId=" + encodeURIComponent(providerId);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      return (await load(url, { signal })) as Status;
    },
    [url],
  );
  useEffect(() => {
    const abort = new AbortController();
    refresh(abort.signal)
      .then(setState)
      .catch(() => {
        if (!abort.signal.aborted)
          setMessage("Consultation booking couldn’t be loaded.");
      });
    return () => abort.abort();
  }, [refresh]);
  const row = state?.bookings[0];
  const pending =
    row && ["searching", "submitting", "unknown"].includes(row.status);
  useEffect(() => {
    if (!pending) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      refresh(abort.signal)
        .then(setState)
        .catch(() => {});
    }, 15000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [pending, refresh]);
  const occupied =
    pending ||
    (row?.status === "confirmed" && Date.parse(row.starts_at!) > openedAt);
  const ready =
    !!state?.configured &&
    !occupied &&
    !busy &&
    !!name.trim() &&
    (!state.phoneRequired || !!phone.trim()) &&
    Date.parse(start) > openedAt &&
    Date.parse(end) > Date.parse(start) &&
    Date.parse(end) - Date.parse(start) <= 7 * 86400000;
  async function act(preview: boolean) {
    if (
      submitting.current ||
      !ready ||
      (!preview && outreachRequestId && !consent)
    )
      return "Enter your name and preferred time window first.";
    submitting.current = true;
    setBusy(true);
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const data = await load(
        "/api/consultations" + (preview ? "?preview=1" : ""),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            ...(outreachRequestId ? { outreachRequestId } : {}),
            name: name.trim(),
            phone: phone.trim() || undefined,
            startTime: new Date(start).toISOString(),
            endTime: new Date(end).toISOString(),
            timezone,
            requestId: requestId.current,
          }),
        },
      );
      let answer;
      if (preview) {
        const times = (data.slots ?? []).slice(0, 3).map((d: string) =>
          new Date(d).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: timezone,
          }),
        );
        answer =
          data.message ??
          (times.length
            ? `The agency has openings at ${times.join("; ")} (${timezone}).`
            : "The agency has no openings in this window.");
      } else {
        setState((old) => old && { ...old, bookings: [data.booking] });
        answer = bookingMessage(data.booking);
        onBooking?.();
        if (["failed", "unavailable"].includes(data.booking.status))
          requestId.current = "";
      }
      setMessage(preview ? answer : "");
      return answer as string;
    } catch (error) {
      const answer =
        error instanceof Error
          ? error.message
          : "Booking status is unavailable.";
      setMessage(answer);
      refresh()
        .then(setState)
        .catch(() => {});
      return answer;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (!state?.configured && outreachRequestId)
    return (
      <p role="status">
        {message ||
          (state
            ? "Actual consultation booking is unavailable for this office. Contact the office directly; no consultation has been requested."
            : "Checking consultation booking availability…")}
      </p>
    );
  if (!state?.configured && state?.publicUrl)
    return (
      <section className={styles.workflow} aria-labelledby={label}>
        <h3 id={label}>Book a consultation</h3>
        {row && !outreachRequestId && <BookingReceipt booking={row} />}
        {providerId === ELDERLY_SAVIOR_PROVIDER_ID && email && !occupied && (
          <PublicFormBooking key={providerId + email} email={email} />
        )}
        <button
          type="button"
          className="button button-outline"
          aria-expanded={showCalendar}
          onClick={() => setShowCalendar(!showCalendar)}
        >
          {showCalendar ? "Hide calendar" : "See live openings"}
        </button>
        {showCalendar && (
          <iframe
            title="Elderly Savior consultation availability"
            src={state.publicUrl + "#calendarAppointmentBookingMain"}
            referrerPolicy="no-referrer"
            className={styles.officeCalendar}
          />
        )}
        <a
          className="text-link"
          href={state.publicUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the agency’s booking calendar
        </a>
      </section>
    );
  if (!state?.configured && !row)
    return message ? <p role="status">{message}</p> : null;
  return (
    <section className={styles.workflow} aria-labelledby={label}>
      <h3 id={label}>Book an agency consultation</h3>
      {row && !outreachRequestId && <BookingReceipt booking={row} />}
      {outreachRequestId && occupied && (
        <p role="status">
          This office already has an active consultation request for your
          account. Review linked consultations above, or check your agency
          consultation history before requesting another.
        </p>
      )}
      {state?.configured && !occupied && (
        <>
          <p>
            Give Harbor a window when you can meet. We’ll arrange a consultation
            within it and use {email} for your invitation.
          </p>
          <fieldset aria-label="Consultation details">
            <label>
              Your name
              <input
                autoComplete="name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {state.phoneRequired && (
              <label>
                Callback number
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  maxLength={25}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            )}
            <label>
              Available from
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Available until
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </fieldset>
          <p>Times in {timezone}. Choose up to seven days.</p>
          {outreachRequestId && (
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I authorize Harbor to contact this office and request a real
              consultation using these details. This does not arrange care.
            </label>
          )}
          <div className={styles.contacts}>
            {state.source !== "phone" && (
              <button
                type="button"
                className="button button-outline"
                disabled={!ready}
                onClick={() => void act(true)}
              >
                Check openings
              </button>
            )}
            <button
              className="button button-primary"
              type="button"
              disabled={!ready || (!!outreachRequestId && !consent)}
              onClick={() => void act(false)}
            >
              {state.source === "phone"
                ? "Ask Harbor to call and book"
                : "Book the first available time"}
            </button>
          </div>
        </>
      )}
      {state?.configured && row?.status !== "confirmed" && (
        <ConsultationVoice
          ready={!!ready && (!outreachRequestId || consent)}
          availability={() => act(true)}
          book={() => act(false)}
        />
      )}
      <p role="status">{message}</p>
    </section>
  );
}
