import { useId, useState } from "react";
import type { Provider } from "@/lib/providers";
import { familyOutreachMessage } from "@/lib/home-care-message";
import { AgencyInquiryLinks } from "../agency-inquiry-links";
import {
  HOME_CARE_INTERVIEW_LABELS,
  homeCareDateTime,
  homeCareNextAction,
  recordHomeCareInterview,
  recordHomeCareIntroduction,
  type HomeCareInterview,
  type HomeCareOutreachRecord,
} from "@/lib/home-care-outreach";
import styles from "./home-care-outreach.module.css";

type InterviewChoice = keyof typeof HOME_CARE_INTERVIEW_LABELS;
function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function readDateTime(value: string) {
  const date = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    localDateTime(date.toISOString()) !== value
  )
    throw new Error("Enter a valid date and time.");
  return date.toISOString();
}

function draftDate(value: string) {
  try {
    return new Date(readDateTime(value));
  } catch {
    return undefined;
  }
}

export function HomeCareOutreach({
  provider,
  record,
  onRecord,
  saveStatus,
  saveError,
  blocked = false,
}: {
  provider: Provider;
  record?: HomeCareOutreachRecord;
  onRecord: (record: HomeCareOutreachRecord) => boolean;
  saveStatus: string;
  saveError: string;
  blocked?: boolean;
}) {
  const uid = useId();
  const interview = record?.interview;
  const [choice, setChoice] = useState<InterviewChoice>(
    interview?.status === "completed"
      ? interview.outcome
      : (interview?.status ?? "not-started"),
  );
  const [interviewTime, setInterviewTime] = useState(
    localDateTime(
      interview?.status === "scheduled"
        ? interview.scheduledAt
        : interview?.status === "completed"
          ? interview.occurredAt
          : undefined,
    ),
  );
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [introductionTime, setIntroductionTime] = useState(
    localDateTime(
      record?.stage === "introduction"
        ? record.introduction.startsAt
        : undefined,
    ),
  );
  const [confirmation, setConfirmation] = useState<
    "proposed" | "confirmed" | "cancelled"
  >(record?.stage === "introduction" ? record.introduction.status : "proposed");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const inputZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const suitableInterview =
    interview?.status === "completed" && interview.outcome === "suitable"
      ? interview
      : undefined;
  const suitable = suitableInterview !== undefined;
  const action = record ? homeCareNextAction(record) : null;
  const interviewChanged =
    interview !== undefined &&
    (choice !==
      (interview.status === "completed"
        ? interview.outcome
        : interview.status) ||
      interviewTime !==
        localDateTime(
          interview.status === "scheduled"
            ? interview.scheduledAt
            : interview.status === "completed"
              ? interview.occurredAt
              : undefined,
        ));
  const introductionDraft = suitable && !interviewChanged;
  const proposedTime = draftDate(introductionTime);
  const introductionReady =
    suitableInterview !== undefined &&
    !interviewChanged &&
    proposedTime !== undefined &&
    proposedTime.getTime() > Date.parse(suitableInterview.occurredAt);
  const purpose = introductionDraft ? "introduction" : "interview";
  const at = introductionDraft
    ? proposedTime
    : choice === "scheduled"
      ? draftDate(interviewTime)
      : undefined;
  const message =
    !blocked && !interviewChanged && (!introductionDraft || introductionReady)
      ? familyOutreachMessage(purpose, at)
      : undefined;

  function apply(next: HomeCareOutreachRecord) {
    if (!onRecord(next)) {
      setError(
        "This change could not be applied. Check the workspace error and try again.",
      );
      return false;
    }
    if (next.stage === "interview") {
      setIntroductionTime("");
      setConfirmation("proposed");
    }
    setError("");
    return true;
  }

  const draft = (
    <section aria-label="Family outreach draft">
      <h4>
        {introductionDraft
          ? "In-home introduction draft"
          : "Interview request draft"}
      </h4>
      {message ? (
        <>
          <p>
            <strong>{message.subject}</strong>
          </p>
          <label htmlFor={`${uid}-message`}>Call, email or form draft</label>
          <textarea
            id={`${uid}-message`}
            readOnly
            rows={9}
            value={message.body}
          />
          <button
            type="button"
            className="button button-outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message.body);
                setCopyStatus("Draft copied.");
              } catch {
                setCopyStatus("Select and copy the draft above.");
              }
            }}
          >
            Copy draft
          </button>
          <div className={styles.contacts} aria-label="Agency contact routes">
            <AgencyInquiryLinks
              providerId={provider.id}
              provider={provider}
              purpose={purpose}
              at={at}
              record={record}
              showUnavailable
            />
          </div>

          <p className="small muted">
            Use this draft on the phone, in an email, or in the agency’s inquiry
            form.
          </p>
        </>
      ) : (
        <p>
          {blocked
            ? "Resolve the workspace conflict before contacting the agency."
            : interviewChanged
              ? "Record the changed interview details before preparing another draft."
              : "Enter a valid introduction date after the recorded interview to prepare an invitation."}
        </p>
      )}
      {copyStatus && <p aria-live="polite">{copyStatus}</p>}
    </section>
  );

  return (
    <section className={styles.workflow} aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`}>Agency interview & in-home introduction</h3>
      <p>
        Your family contacts the agency and records what actually happens. This
        is separate from voice rehearsal. Harbor does not send, dial or book
        anything.
      </p>
      {action && (
        <p className={styles.next}>
          <strong>Next action</strong> {action.label}
          {action.at && (
            <>
              <br />
              <time dateTime={action.at}>{homeCareDateTime(action.at)}</time>
            </>
          )}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            let nextInterview: HomeCareInterview;
            if (choice === "scheduled")
              nextInterview = {
                status: "scheduled",
                scheduledAt: readDateTime(interviewTime),
              };
            else if (choice === "suitable" || choice === "not-suitable")
              nextInterview = {
                status: "completed",
                outcome: choice,
                occurredAt: readDateTime(interviewTime),
              };
            else nextInterview = { status: choice };
            if (
              nextInterview.status === "completed" &&
              nextInterview.occurredAt > new Date().toISOString()
            )
              throw new Error(
                "An actual interview cannot have happened in the future.",
              );
            apply(
              recordHomeCareInterview(
                provider.name,
                record,
                nextInterview,
                notes,
              ),
            );
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Check the interview details.",
            );
          }
        }}
      >
        <fieldset disabled={blocked}>
          <legend>1. Interview the agency</legend>
          <label htmlFor={`${uid}-outcome`}>
            Interview status or actual outcome
          </label>
          <select
            id={`${uid}-outcome`}
            value={choice}
            onChange={(event) => {
              const value = event.target.value as InterviewChoice;
              setChoice(value);
              setInterviewTime("");
            }}
          >
            {Object.entries(HOME_CARE_INTERVIEW_LABELS).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
          {(choice === "scheduled" ||
            choice === "suitable" ||
            choice === "not-suitable") && (
            <>
              <label htmlFor={`${uid}-interview-time`}>
                {choice === "scheduled"
                  ? "Interview date and time"
                  : "Actual interview date and time"}
              </label>
              <input
                id={`${uid}-interview-time`}
                type="datetime-local"
                required
                value={interviewTime}
                onChange={(event) => setInterviewTime(event.target.value)}
              />
              <small>
                Input time zone: {inputZone}. Drafts use New Jersey Eastern
                time.
              </small>
            </>
          )}
          {!introductionDraft && draft}
          <label htmlFor={`${uid}-notes`}>Family interview notes</label>
          <textarea
            id={`${uid}-notes`}
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Care fit, availability, costs and questions. Leave out sensitive information."
          />
          {record?.stage === "introduction" && interviewChanged && (
            <p>
              Changing the interview outcome or time clears the existing
              introduction. Arrange it again after saving a suitable interview.
            </p>
          )}
          <button type="submit" className="button button-primary">
            Record interview details
          </button>
        </fieldset>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (!record) throw new Error("Record the interview first.");
            apply(
              recordHomeCareIntroduction(record, {
                status: confirmation,
                startsAt: readDateTime(introductionTime),
              }),
            );
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Check the introduction details.",
            );
          }
        }}
      >
        <fieldset disabled={blocked || !suitable || interviewChanged}>
          <legend>2. Invite the agency for an in-home introduction</legend>
          <p>
            {suitable
              ? "Choose a proposed time for your invitation. Record the details separately after contacting the agency."
              : "Complete an actual interview and record that the agency is suitable before arranging an introduction."}
          </p>
          <label htmlFor={`${uid}-introduction-time`}>
            In-home introduction date and time
          </label>
          <input
            id={`${uid}-introduction-time`}
            type="datetime-local"
            required
            value={introductionTime}
            onChange={(event) => {
              setIntroductionTime(event.target.value);
              setConfirmation("proposed");
            }}
          />
          <small>
            Input time zone: {inputZone}. Drafts use New Jersey Eastern time.
          </small>
          {introductionDraft && draft}
          <label htmlFor={`${uid}-confirmation`}>
            Family-recorded confirmation status
          </label>
          <select
            id={`${uid}-confirmation`}
            value={confirmation}
            onChange={(event) =>
              setConfirmation(event.target.value as typeof confirmation)
            }
          >
            <option value="proposed">Proposed, not confirmed</option>
            <option value="confirmed">
              Confirmed directly with the agency by our family
            </option>
            <option value="cancelled">Cancelled</option>
          </select>
          <p className="small muted">
            Only choose confirmed after your family has received confirmation.
            Harbor has not verified it.
          </p>
          <button type="submit" className="button button-primary">
            Record introduction details
          </button>
        </fieldset>
      </form>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status">{saveError || saveStatus}</p>
    </section>
  );
}

export function HomeCareOutreachPlan({
  records,
  open,
}: {
  records: Record<string, HomeCareOutreachRecord>;
  open: (providerId: string) => void;
}) {
  if (!Object.keys(records).length) return null;
  return (
    <section
      className={styles.workflow}
      aria-label="Agency interviews and introductions"
    >
      <h2>Agency interviews & introductions</h2>
      <p>Actual family-recorded activity, separate from voice rehearsal.</p>
      {Object.entries(records).map(([id, record]) => {
        const action = homeCareNextAction(record);
        return (
          <article key={id} className={styles.next}>
            <h3>{record.providerName}</h3>
            <p>{action.label}</p>
            {action.at && (
              <p>
                <time dateTime={action.at}>{homeCareDateTime(action.at)}</time>
              </p>
            )}
            <button className="button button-outline" onClick={() => open(id)}>
              Open agency workflow for {record.providerName}
            </button>
          </article>
        );
      })}
    </section>
  );
}
