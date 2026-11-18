import { useEffect, useState } from "react";
import {
  isRehearsalReceipt,
  parseReceiptCursor,
  type RehearsalReceipt,
} from "@/lib/outreach-rehearsal-receipt";

export function RehearsalReports({
  requestId,
  revision,
}: {
  requestId: string;
  revision: number;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>Simulated rehearsal reports</summary>
      {opened && <Reports key={revision} requestId={requestId} />}
    </details>
  );
}

function Reports({ requestId }: { requestId: string }) {
  const [load, setLoad] = useState<{ before: string | null }>({ before: null });
  const [result, setResult] = useState<{
    load: typeof load;
    receipts: RehearsalReceipt[];
    nextCursor: string | null;
    error?: boolean;
  }>();
  const loading = result?.load !== load;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function fetchPage() {
      try {
        const query = new URLSearchParams({ requestId });
        if (load.before) query.set("before", load.before);
        const response = await fetch(
          `/api/outreach-rehearsal-receipts?${query}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
            signal,
          },
        );
        if (!response.ok) throw new Error();
        const page = await response.json();
        if (
          !Array.isArray(page?.receipts) ||
          !page.receipts.every(
            (receipt: unknown) =>
              isRehearsalReceipt(receipt) && receipt.requestId === requestId,
          ) ||
          (page.nextCursor !== null &&
            (typeof page.nextCursor !== "string" ||
              !parseReceiptCursor(page.nextCursor) ||
              page.nextCursor === load.before))
        )
          throw new Error();

        const receipts: RehearsalReceipt[] = page.receipts;
        if (!signal.aborted)
          setResult((current) => {
            const previous = current?.receipts ?? [];
            const seen = new Set(previous.map(({ runId }) => runId));
            return {
              load,
              receipts: [
                ...previous,
                ...receipts.filter(({ runId }) => !seen.has(runId)),
              ],
              nextCursor: page.nextCursor,
            };
          });
      } catch {
        if (!signal.aborted)
          setResult((current) => ({
            load,
            receipts: current?.receipts ?? [],
            nextCursor: null,
            error: true,
          }));
      }
    }
    void fetchPage();
    return () => controller.abort();
  }, [load, requestId]);

  const next = result?.nextCursor;
  return (
    <>
      <p className="small muted">
        Practice only. These reports do not confirm provider contact or a
        booking.
      </p>
      {loading && <p role="status">Loading simulated rehearsal reports…</p>}
      {!loading && result?.error && (
        <div>
          <p role="alert" className="form-error">
            Could not load simulated rehearsal reports.
          </p>
          <button
            type="button"
            className="text-link"
            onClick={() => setLoad({ before: load.before })}
          >
            Retry reports
          </button>
        </div>
      )}
      {!loading && !result?.error && result?.receipts.length === 0 && (
        <p>No simulated rehearsal reports yet.</p>
      )}
      {result?.receipts.map(({ runId, createdAt, outcome }) => (
        <article key={runId}>
          <h4>
            {outcome.status === "completed"
              ? "Simulation completed"
              : "Simulation interrupted"}
          </h4>
          <time dateTime={createdAt}>
            {new Date(createdAt).toLocaleString()}
          </time>
          {outcome.takeaways.length > 0 && (
            <>
              <p>Practice takeaways</p>
              <ul>
                {outcome.takeaways.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </>
          )}
          {outcome.nextSteps.length > 0 && (
            <>
              <p>Suggested next steps</p>
              <ul>
                {outcome.nextSteps.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </>
          )}
        </article>
      ))}
      {next && (
        <button
          type="button"
          className="text-link"
          disabled={loading}
          onClick={() => setLoad({ before: next })}
        >
          Load older reports
        </button>
      )}
    </>
  );
}
