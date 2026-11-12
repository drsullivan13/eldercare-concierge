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
      <a
        className="research-source"
        href={staffing.careCompareUrl}
        target="_blank"
        rel="noreferrer"
      >
        CMS · CCN {staffing.ccn} · checked{" "}
        {evidenceDate(staffing.retrievedAt.slice(0, 10))}
      </a>
      <details>
        <summary>Turnover, census &amp; source notes</summary>
        <p>
          Turnover · {evidenceDate(turnoverPeriod.startDate)} to{" "}
          {evidenceDate(turnoverPeriod.endDate)} · {turnoverPeriod.label}. Total
          nursing staff · {value(metrics.totalTurnover)}
          {metrics.totalTurnover.status === "reported" ? "%" : ""}. RNs ·{" "}
          {value(metrics.rnTurnover)}
          {metrics.rnTurnover.status === "reported" ? "%" : ""}.
        </p>
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
        <a
          className="research-source"
          href={turnoverPeriod.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          CMS turnover measurement period
        </a>
        <a
          className="research-source"
          href={staffingPeriod.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          CMS measurement periods
        </a>
        <a
          className="research-source"
          href={staffing.dictionaryUrl}
          target="_blank"
          rel="noreferrer"
        >
          CMS definitions &amp; footnotes
        </a>
        <a
          className="research-source"
          href={staffing.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          CMS Provider Information dataset
        </a>
      </details>
    </section>
  );
}
