import { useId, useState, useSyncExternalStore } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { useOutreach } from "@/hooks/use-outreach";
import type { OutreachProvider, OutreachRecord } from "@/lib/outreach";
import { formatPhone } from "@/lib/providers";
import { Modal } from "../modal";
import styles from "./outreach.module.css";

type Outreach = ReturnType<typeof useOutreach>;
const goals = [
  "Arrange tour",
  "Pricing",
  "Availability",
  "Waitlist",
  "Care services",
];
const stages: Record<OutreachRecord["state"], string> = {
  requested: "Ready to open",
  opened: "Rehearsal opened",
  connected: "Browser agent connected",
  completed: "Rehearsal completed",
  failed: "Rehearsal interrupted",
};
const commitmentLabels = {
  scheduled: "Scheduled",
  agreed: "Agreed",
  proposed: "Proposed",
  cancelled: "Cancelled",
};

function textKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function subscribeOnline(change: () => void) {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
}
function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function OutreachEditor({
  provider,
  parent,
  launch,
  error,
  close,
}: {
  provider: OutreachProvider;
  parent?: OutreachRecord;
  launch: Outreach["launch"];
  error: string;
  close: () => void;
}) {
  const uid = useId();
  const online = useOnline();
  const [topics, setTopics] = useState<string[]>(parent?.brief.topics ?? []);
  const [question, setQuestion] = useState("");
  const [attempted, setAttempted] = useState(false);
  const questionField = useId();
  const choices = [...new Set([...goals, ...(parent?.brief.topics ?? [])])];
  const suggestions = [...new Set(parent?.nextSteps ?? [])].filter(
    (item) => !choices.includes(item),
  );
  const valid = topics.length > 0 || question.trim().length > 0;
  function toggle(topic: string) {
    setTopics((current) =>
      current.includes(topic)
        ? current.filter((item) => item !== topic)
        : [...current, topic],
    );
  }
  return (
    <Modal
      title={parent ? "Follow-up rehearsal" : "Prepare outreach"}
      close={close}
    >
      <form
        className={styles.editor}
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (!valid || !navigator.onLine) return;
          if (launch(provider, topics, question.trim(), parent)) close();
        }}
      >
        <h2 className={styles.provider}>{provider.providerName}</h2>
        <p className={styles.notice}>
          Practice in the browser. No provider will be called.
        </p>
        {provider.phone && (
          <p className="small muted">{formatPhone(provider.phone)}</p>
        )}
        <fieldset className={styles.goals}>
          <legend>
            {choices.length > 6 ? "Choose up to 6 goals" : "Choose your goals"}
          </legend>
          {choices.map((goal) => (
            <label key={goal}>
              <input
                type="checkbox"
                checked={topics.includes(goal)}
                disabled={topics.length >= 6 && !topics.includes(goal)}
                onChange={() => toggle(goal)}
              />
              <span>{goal}</span>
            </label>
          ))}
        </fieldset>
        {suggestions.length > 0 && (
          <div className={styles.suggestions}>
            <h3>Previous next steps</h3>
            {suggestions.map((item) => (
              <div key={item}>
                <p>{item}</p>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setQuestion(item.slice(0, 1000));
                    document.getElementById(questionField)?.focus();
                  }}
                >
                  {item.length > 1000
                    ? "Use first 1000 characters as question"
                    : "Use as question"}
                </button>
              </div>
            ))}
          </div>
        )}
        <label className={styles.question} htmlFor={questionField}>
          Your question or another goal
        </label>
        <textarea
          id={questionField}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="What would make your next conversation useful?"
          aria-describedby={`${uid}-guidance${attempted && !valid ? ` ${uid}-validation` : ""}`}
          aria-invalid={attempted && !valid}
        />
        <p id={`${uid}-guidance`} className="small muted">
          {question.length}/1000. Leave out names and sensitive personal
          details.
        </p>
        {attempted && !valid && (
          <p id={`${uid}-validation`} className="form-error" role="alert">
            Choose at least one goal or write a question.
          </p>
        )}
        {!online && (
          <p role="status" className="form-error">
            You are offline. Your draft stays here. Reconnect to open a
            rehearsal.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className="button button-outline"
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={!online}
          >
            Open rehearsal <ExternalLink size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </Modal>
  );
}

const activityFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function activityDate(value: string) {
  return activityFormatter.format(new Date(value));
}

function OutreachPlanAction({
  step,
  providerId,
  addTask,
}: {
  step: string;
  providerId: string;
  addTask: (title: string, providerId: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const uid = useId();
  function save(value: string) {
    if (!addTask(value, providerId)) {
      setError(
        "Could not add this next step. Check your workspace storage and plan limits, then try again.",
      );
      return;
    }
    setAdded(true);
    setEditing(false);
    setError("");
  }
  return (
    <>
      {editing ? (
        <div className={styles.taskEditor}>
          <label htmlFor={uid}>Summarize this next step for your plan</label>
          <input
            id={uid}
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          <span className="small muted">
            {title.length}/200 characters. The full next step stays in outreach
            history.
          </span>
          <div className={styles.actions}>
            <button
              className="button button-outline"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              className="button button-outline"
              disabled={!title.trim()}
              onClick={() => save(title.trim())}
            >
              Add to plan
            </button>
          </div>
        </div>
      ) : (
        <button
          className="text-link"
          disabled={added}
          onClick={() => (step.length > 200 ? setEditing(true) : save(step))}
          aria-label={`${added ? "Added to plan" : step.length > 200 ? "Summarize for plan" : "Add to plan"}: ${step}`}
        >
          {added
            ? "Added to plan"
            : step.length > 200
              ? "Summarize for plan"
              : "Add to plan"}
        </button>
      )}
      {added && (
        <p role="status" className="small muted">
          Next step added to your plan.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </>
  );
}

function OutreachEntry({
  record,
  reopen,
  followUp,
  addTask,
  online,
  entryId,
  previousEntryId,
}: {
  record: OutreachRecord;
  reopen: Outreach["reopen"];
  followUp: (record: OutreachRecord) => void;
  addTask: (title: string, providerId: string) => boolean;
  online: boolean;
  entryId: string;
  previousEntryId?: string;
}) {
  const canReopen = record.state !== "completed";
  const commitments = new Map<
    string,
    { text: string; kinds: (keyof typeof commitmentLabels)[] }
  >();
  for (const commitment of record.commitments ?? []) {
    const key = textKey(commitment.text);
    const existing = commitments.get(key);
    if (existing) {
      if (!existing.kinds.includes(commitment.kind))
        existing.kinds.push(commitment.kind);
    } else {
      commitments.set(key, { text: commitment.text, kinds: [commitment.kind] });
    }
  }
  const nextSteps = [
    ...new Map(record.nextSteps.map((step) => [textKey(step), step])).values(),
  ];
  const supportingText = new Set([
    ...commitments.keys(),
    ...nextSteps.map(textKey),
    textKey(record.brief.question),
  ]);
  const disclaimer = `Rehearsal only. These are the practice receptionist's own words, not verified facts about ${record.brief.providerName}. No real placement, tour or booking was made.`;
  const notes = record.findings
    .filter((finding) => finding !== disclaimer)
    .map((finding) =>
      finding.replace(/^Receptionist said: "([\s\S]*)"$/, "$1"),
    );
  const findings = [
    ...new Map(notes.map((finding) => [textKey(finding), finding])).values(),
  ].filter((finding) => !supportingText.has(textKey(finding)));
  const activity = [
    ...new Map(
      [
        { state: "requested" as const, at: record.createdAt },
        ...(record.activity?.length
          ? record.activity
          : record.state !== "requested"
            ? [{ state: record.state, at: record.updatedAt }]
            : []),
      ].map((event) => [`${event.state}:${event.at}`, event]),
    ).values(),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <article
      className={styles.entry}
      id={entryId}
      tabIndex={-1}
      aria-label={`${record.brief.providerName}, ${activityDate(record.createdAt)}`}
    >
      <header>
        <div className={styles.identity}>
          <h3>{record.brief.providerName}</h3>
          <p className="small muted">
            Last activity{" "}
            <time dateTime={record.updatedAt}>
              {activityDate(record.updatedAt)}
            </time>
          </p>
        </div>
        <span className={styles.stage} data-state={record.state}>
          {stages[record.state]}
        </span>
      </header>
      {record.parentId &&
        (previousEntryId ? (
          <a
            className={styles.previous}
            href={`#${previousEntryId}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(previousEntryId)?.focus();
            }}
          >
            Follow-up rehearsal · View previous rehearsal
          </a>
        ) : (
          <p className="small muted">
            Follow-up rehearsal · Previous rehearsal is not in this view.
          </p>
        ))}
      {commitments.size > 0 && (
        <div className={styles.commitments}>
          <h4>Appointments & agreements</h4>
          <p className="small muted">
            Practice outcomes. Confirm any appointment with the provider.
          </p>
          <ul className={styles.commitmentList}>
            {[...commitments].map(([key, commitment]) => {
              const step = nextSteps.find((item) => textKey(item) === key);
              return (
                <li key={key}>
                  <div className={styles.commitmentKinds}>
                    {commitment.kinds.map((kind) => (
                      <span
                        key={kind}
                        className={styles.commitmentKind}
                        data-kind={kind}
                      >
                        {commitmentLabels[kind]}
                      </span>
                    ))}
                  </div>
                  <p>{commitment.text}</p>
                  {step && (
                    <OutreachPlanAction
                      step={step}
                      providerId={record.brief.providerId}
                      addTask={addTask}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {nextSteps.some((step) => !commitments.has(textKey(step))) && (
        <div className={styles.detail}>
          <h4>Next steps to confirm</h4>
          <ul className={styles.nextSteps}>
            {nextSteps
              .filter((step) => !commitments.has(textKey(step)))
              .map((step) => (
                <li key={textKey(step)}>
                  <span>{step}</span>
                  <OutreachPlanAction
                    step={step}
                    providerId={record.brief.providerId}
                    addTask={addTask}
                  />
                </li>
              ))}
          </ul>
        </div>
      )}
      {(record.brief.topics.length > 0 || record.brief.question) && (
        <div className={styles.detail}>
          <h4>Questions & goals</h4>
          {record.brief.topics.length > 0 && (
            <p className={styles.topics}>{record.brief.topics.join(" · ")}</p>
          )}
          {record.brief.question &&
            !commitments.has(textKey(record.brief.question)) &&
            !nextSteps.some(
              (step) => textKey(step) === textKey(record.brief.question),
            ) && <p className={styles.questionText}>{record.brief.question}</p>}
        </div>
      )}
      <div className={styles.detail}>
        <h4>Rehearsal notes</h4>
        {findings.length ? (
          <ul>
            {findings.map((finding) => (
              <li key={textKey(finding)}>{finding}</li>
            ))}
          </ul>
        ) : (
          <p className="small muted">
            {record.findings.length || commitments.size
              ? "No additional notes."
              : record.state === "failed"
                ? "The browser rehearsal did not finish. No provider was dialed."
                : record.state === "completed"
                  ? "No findings were returned. Provider answers still need confirmation."
                  : "No findings yet. Open the rehearsal, then refresh after the browser session."}
          </p>
        )}
      </div>
      <details className={styles.activity}>
        <summary>Rehearsal activity</summary>
        <ol aria-label="Rehearsal activity, oldest first">
          {activity.map((event) => (
            <li key={`${event.state}:${event.at}`}>
              <span>
                {event.state === "requested"
                  ? "Outreach prepared"
                  : stages[event.state]}
              </span>
              <time dateTime={event.at}>{activityDate(event.at)}</time>
            </li>
          ))}
        </ol>
      </details>
      <div className={styles.actions}>
        {canReopen && (
          <button
            className="button button-outline"
            onClick={() => reopen(record)}
            disabled={!online}
          >
            Reopen rehearsal <ExternalLink size={15} aria-hidden="true" />
          </button>
        )}
        <button
          className="button button-outline"
          onClick={() => followUp(record)}
        >
          Prepare follow-up
        </button>
      </div>
    </article>
  );
}

export function OutreachHistory({
  records,
  refreshing,
  refresh,
  error,
  reopen,
  followUp,
  addTask,
  findCare,
  viewPlan,
}: Pick<Outreach, "records" | "refreshing" | "refresh" | "error" | "reopen"> & {
  followUp: (record: OutreachRecord) => void;
  addTask: (title: string, providerId: string) => boolean;
  findCare?: () => void;
  viewPlan?: () => void;
}) {
  const online = useOnline();
  const uid = useId();
  const [refreshed, setRefreshed] = useState(false);
  const ordered = [...records].sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.brief.requestId.localeCompare(b.brief.requestId),
  );
  const entryIds = new Map(
    ordered.map((record, index) => [
      record.brief.requestId,
      `${uid}-entry-${index}`,
    ]),
  );
  return (
    <section className={styles.history} aria-labelledby={`${uid}-heading`}>
      <div className={styles.heading}>
        <div>
          <h2 id={`${uid}-heading`}>Outreach history</h2>
          <p className="small muted">
            {viewPlan
              ? "This provider's rehearsals."
              : "All providers, including those not on your shortlist."}
          </p>
        </div>
        <button
          className="button button-outline"
          disabled={refreshing || !online || records.length === 0}
          onClick={async () => {
            setRefreshed(false);
            await refresh();
            setRefreshed(true);
          }}
        >
          <RefreshCw
            size={15}
            className={refreshing ? "spin" : ""}
            aria-hidden="true"
          />
          {refreshing ? "Refreshing…" : "Refresh outreach"}
        </button>
      </div>
      <p className={styles.disclaimer}>
        Browser rehearsals only. No provider is dialed.
      </p>
      {viewPlan && (
        <button className="text-link" onClick={viewPlan}>
          View all outreach in Your plan
        </button>
      )}
      {!online && (
        <p role="status" className="form-error">
          You are offline. Saved history is still available. Reconnect to
          refresh or reopen a rehearsal.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status" className={`${styles.refreshStatus} small muted`}>
        {refreshing
          ? "Checking for rehearsal results…"
          : refreshed && !error
            ? "Outreach history refreshed."
            : ""}
      </p>
      {records.length ? (
        <>
          <p className={styles.order}>
            {records.length}{" "}
            {records.length === 1
              ? "rehearsal"
              : "rehearsals · Newest activity first"}
          </p>
          {ordered.map((record) => (
            <OutreachEntry
              key={record.brief.requestId}
              record={record}
              reopen={reopen}
              followUp={followUp}
              addTask={addTask}
              online={online}
              entryId={entryIds.get(record.brief.requestId)!}
              previousEntryId={
                record.parentId ? entryIds.get(record.parentId) : undefined
              }
            />
          ))}
        </>
      ) : (
        <div className={styles.empty}>
          <p>No outreach rehearsals yet.</p>
          <p className="small muted">
            Open a provider profile and choose Prepare outreach. You do not need
            to save the provider first.
          </p>
          {findCare && (
            <button className="button button-outline" onClick={findCare}>
              Find a provider
            </button>
          )}
        </div>
      )}
    </section>
  );
}
