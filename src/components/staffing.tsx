import type { NursingStaffingResearch } from "@/lib/nursing-staffing-types";
import { evidenceDate } from "./evidence-date";
import "./staffing.css";

const roles = [
  ["rn", "Registered nurses (RNs)"],
  ["lpn", "Licensed practical nurses (LPNs)"],
  ["aide", "Nurse aides"],
] as const;
const weekends = [
  ["weekendTotal", "Weekend total"],
  ["weekendRn", "Weekend RNs (included in total)"],
] as const;

function value(metric: NursingStaffingResearch["metrics"]["total"]) {
  if (metric.status !== "reported")
    return metric.status === "suppressed"
      ? "Suppressed by CMS"
      : "Not published";
  return metric.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function Staffing({
  staffing,
}: {
  staffing?: NursingStaffingResearch | null;
}) {
  if (!staffing) return null;
  const { metrics, staffingPeriod, turnoverPeriod } = staffing;
  const notes = [
    ...new Set(
      Object.values(metrics).flatMap((metric) =>
        metric.footnote ? [metric.footnote] : [],
      ),
    ),
  ];
  return (
    <section
      className="daily-life-group daily-life-staffing staffing-evidence"
      aria-label="CMS staffing hours"
    >
      <h5>CMS staffing hours</h5>
      <p className="daily-life-date">
        Staffing period · {evidenceDate(staffingPeriod.startDate)} to{" "}
        {evidenceDate(staffingPeriod.endDate)} · {staffingPeriod.label}
      </p>
      <p>Hours per resident-day for this nursing unit.</p>
      <dl className="staffing-roles">
        <div className="staffing-total">
          <dt>Total nursing care</dt>
          <dd>
            {metrics.total.status === "reported" ? (
              <strong>{value(metrics.total)}</strong>
            ) : (
              value(metrics.total)
            )}
          </dd>
        </div>
        {roles.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{value(metrics[key])}</dd>
          </div>
        ))}
      </dl>
      <h6>Weekend care</h6>
      <dl className="staffing-roles staffing-weekends">
        {weekends.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{value(metrics[key])}</dd>
          </div>
        ))}
      </dl>
      <p>
        RNs, LPNs and aides make up the total. These are daily averages, not a
        simultaneous staff-to-resident ratio, a headcount or a promise of
        coverage on any shift.
      </p>
      {staffing.staffingRatingNote && (
        <p role="note">{staffing.staffingRatingNote}</p>
      )}
      <details>
        <summary>Turnover, census &amp; source notes</summary>
        <h6>Staff turnover</h6>
        <p className="daily-life-date">
          {evidenceDate(turnoverPeriod.startDate)} to{" "}
          {evidenceDate(turnoverPeriod.endDate)} · {turnoverPeriod.label}. Total{" "}
          nursing staff and RNs are reported separately.
        </p>
        <dl className="staffing-roles">
          <div>
            <dt>Total nursing staff</dt>
            <dd>
              {value(metrics.totalTurnover)}
              {metrics.totalTurnover.status === "reported" ? "%" : ""}
            </dd>
          </div>
          <div>
            <dt>Registered nurses (RNs)</dt>
            <dd>
              {value(metrics.rnTurnover)}
              {metrics.rnTurnover.status === "reported" ? "%" : ""}
            </dd>
          </div>
        </dl>
        <h6>Resident census</h6>
        <p>
          Average residents per day · {value(metrics.census)}. CMS reports this
          census from MDS daily counts. It is not a staff headcount.
        </p>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>
          CMS processing date · {evidenceDate(staffing.processingDate)}. This is
          not the staffing measurement period.
        </p>
        <h6>CMS sources</h6>
        <a
          className="research-source"
          href={staffing.careCompareUrl}
          target="_blank"
          rel="noreferrer"
        >
          CMS · CCN {staffing.ccn} · checked{" "}
          {evidenceDate(staffing.retrievedAt.slice(0, 10))}
        </a>
        {[
          ...new Map([
            [staffingPeriod.sourceUrl, "CMS measurement periods"],
            [turnoverPeriod.sourceUrl, "CMS turnover measurement period"],
            [staffing.dictionaryUrl, "CMS definitions & footnotes"],
            [staffing.sourceUrl, "CMS Provider Information dataset"],
          ]).entries(),
        ].map(([url, label]) => (
          <a
            key={url}
            className="research-source"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        ))}
      </details>
    </section>
  );
}
