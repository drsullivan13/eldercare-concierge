import { useEffect, useState } from "react";
import { AgencyConsultation } from "./agency-consultation";

type Booking = {
  bookingId: string;
  providerId: string;
  status: string;
  source: string;
  startsAt: string | null;
  timezone: string;
  nextAction: string;
};
const actions: Record<string, string> = {
  wait_for_receipt:
    "Wait for the office’s booking receipt. No consultation is confirmed yet.",
  review_confirmation:
    "Review the confirmed consultation time with the office. Care has not been arranged.",
  choose_another_window:
    "Choose another availability window or contact the office.",
  contact_office:
    "Contact the office to discuss next steps. No consultation is confirmed.",
};
const statuses: Record<string, string> = {
  searching: "Checking openings",
  submitting: "Request submitted",
  unknown: "Awaiting receipt",
  confirmed: "Consultation confirmed",
  past: "Past confirmed consultation",
  expired: "Availability expired",
  unavailable: "No openings",
  failed: "Request unsuccessful",
};
const sources: Record<string, string> = {
  phone: "Phone booking",
  calendly: "Calendly",
  highlevel: "Office calendar",
};

export function LinkedConsultations(props: {
  requestId: string;
  providerId: string;
  email: string;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>Actual consultations for this request</summary>
      {opened && (
        <LinkedHistory
          key={props.requestId + props.providerId + props.email}
          {...props}
        />
      )}
    </details>
  );
}
function LinkedHistory({
  requestId,
  providerId,
  email,
}: {
  requestId: string;
  providerId: string;
  email: string;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    bookings: Booking[];
    error?: boolean;
  }>();
  const [booking, setBooking] = useState(false);
  const loading = result?.revision !== revision;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/outreach-bookings?${new URLSearchParams({ requestId })}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (
          !Array.isArray(data.bookings) ||
          data.bookings.length > 10 ||
          !data.bookings.every(
            (row: Booking) =>
              row &&
              row.providerId === providerId &&
              typeof row.bookingId === "string" &&
              Object.hasOwn(statuses, row.status) &&
              Object.hasOwn(sources, row.source) &&
              Object.hasOwn(actions, row.nextAction) &&
              (!["confirmed", "past"].includes(row.status) ||
                (typeof row.startsAt === "string" &&
                  Number.isFinite(Date.parse(row.startsAt)) &&
                  typeof row.timezone === "string")),
          )
        )
          throw new Error();
        // Validate the timezone before using it in rendering.
        for (const row of data.bookings)
          if (["confirmed", "past"].includes(row.status))
            new Intl.DateTimeFormat(undefined, { timeZone: row.timezone });
        if (!controller.signal.aborted)
          setResult({ revision, bookings: data.bookings });
      } catch {
        if (!controller.signal.aborted)
          setResult({ revision, bookings: [], error: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [requestId, providerId, revision]);
  return (
    <div>
      <p>
        These are real consultation requests linked to this office and outreach
        request. Simulated rehearsals do not contact the office or arrange care.
      </p>
      {loading ? (
        <p role="status">Loading linked consultations…</p>
      ) : result?.error ? (
        <p role="alert">
          Could not verify linked consultations. Retry before requesting a
          consultation.
        </p>
      ) : (
        <>
          {!result?.bookings.length && (
            <p>No actual consultations are linked to this request.</p>
          )}
          {result?.bookings.map((row) => (
            <article key={row.bookingId}>
              <h4>{statuses[row.status]}</h4>
              <p>Verified booking ledger · {sources[row.source]}</p>
              {["confirmed", "past"].includes(row.status) && row.startsAt && (
                <p>
                  <time dateTime={row.startsAt}>
                    {new Date(row.startsAt).toLocaleString(undefined, {
                      timeZone: row.timezone,
                    })}
                  </time>{" "}
                  ({row.timezone})
                </p>
              )}
              <p>{actions[row.nextAction]}</p>
            </article>
          ))}
          <button
            type="button"
            className="text-link"
            onClick={() => setBooking(!booking)}
          >
            {booking
              ? "Close consultation request"
              : "Request an actual consultation with this office"}
          </button>
          {booking && (
            <AgencyConsultation
              key={requestId}
              providerId={providerId}
              email={email}
              outreachRequestId={requestId}
              onBooking={() => setRevision((value) => value + 1)}
            />
          )}
        </>
      )}
      <button
        type="button"
        className="text-link"
        disabled={loading}
        onClick={() => setRevision((value) => value + 1)}
      >
        Refresh linked consultations
      </button>
    </div>
  );
}
