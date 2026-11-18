const receiptId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const receiptTimestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type RehearsalReceipt = {
  runId: string;
  requestId: string;
  createdAt: string;
  outcome: {
    status: "completed" | "failed";
    takeaways: string[];
    nextSteps: string[];
  };
};

export function isReceiptId(value: unknown): value is string {
  return typeof value === "string" && receiptId.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    receiptTimestamp.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutcomeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 6 &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length &&
        [...item].length <= 240,
    )
  );
}

export function isRehearsalReceipt(value: unknown): value is RehearsalReceipt {
  if (!isObject(value)) return false;
  const { runId, requestId, createdAt, outcome } = value;
  return (
    Object.keys(value).length === 4 &&
    isReceiptId(runId) &&
    isReceiptId(requestId) &&
    isTimestamp(createdAt) &&
    isObject(outcome) &&
    Object.keys(outcome).length === 3 &&
    (outcome.status === "completed" || outcome.status === "failed") &&
    isOutcomeList(outcome.takeaways) &&
    isOutcomeList(outcome.nextSteps)
  );
}

export function parseReceiptCursor(value: string) {
  const [createdAt, runId, extra] = value.split("|", 3);
  if (extra !== undefined || !isTimestamp(createdAt) || !isReceiptId(runId))
    return null;
  return { createdAt, runId: runId.toLowerCase() };
}
