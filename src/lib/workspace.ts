import { parseOutreachRecord, type OutreachRecord } from "./outreach";

type WorkspaceTask = {
  id: string;
  title: string;
  category: string;
  dueDate: string;
  status: "todo" | "done";
  providerId?: string;
};

export type Workspace = {
  profile: {
    name: string;
    relationship: string;
    zip: string;
    careTypes: string[];
  };
  savedProviderIds: string[];
  notes: Record<string, string>;
  tasks: WorkspaceTask[];
  outreach?: OutreachRecord[];
  updatedAt: string;
};

export const MAX_WORKSPACE_BYTES = 128 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function createEmptyWorkspace(): Workspace {
  return {
    profile: { name: "", relationship: "", zip: "", careTypes: [] },
    savedProviderIds: [],
    notes: {},
    tasks: [],
    updatedAt: new Date().toISOString(),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every(
    (key) => allowed.includes(key) && !RESERVED_KEYS.has(key),
  );
}

function boundedString(value: unknown, max: number, min = 0): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    value.trim().length >= min &&
    !/[\u0000]/.test(value)
  );
}

function id(value: unknown): value is string {
  return (
    typeof value === "string" && ID.test(value) && !RESERVED_KEYS.has(value)
  );
}

function date(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export type WorkspaceValidation =
  { ok: true; workspace: Workspace } | { ok: false; error: string };

/** Reject unknown fields so owner IDs, staff approvals and arbitrary state cannot be smuggled in. */
export function validateWorkspace(value: unknown): WorkspaceValidation {
  const invalid = (error: string): WorkspaceValidation => ({
    ok: false,
    error,
  });
  if (
    !object(value) ||
    !keys(value, [
      "profile",
      "savedProviderIds",
      "notes",
      "tasks",
      "outreach",
      "updatedAt",
    ])
  ) {
    return invalid(
      "Workspace must contain only profile, savedProviderIds, notes, tasks, outreach and updatedAt.",
    );
  }
  const p = value.profile;
  if (
    !object(p) ||
    !keys(p, ["name", "relationship", "zip", "careTypes"]) ||
    !boundedString(p.name, 120) ||
    !boundedString(p.relationship, 80) ||
    typeof p.zip !== "string" ||
    !(p.zip === "" || /^\d{5}$/.test(p.zip)) ||
    !Array.isArray(p.careTypes) ||
    p.careTypes.length > 20 ||
    !p.careTypes.every((item) => boundedString(item, 80, 1))
  ) {
    return invalid(
      "Profile needs bounded text, an empty or five-digit ZIP, and at most 20 care types.",
    );
  }
  if (
    !Array.isArray(value.savedProviderIds) ||
    value.savedProviderIds.length > 100 ||
    !value.savedProviderIds.every(id) ||
    new Set(value.savedProviderIds).size !== value.savedProviderIds.length
  ) {
    return invalid("Save up to 100 distinct provider IDs.");
  }
  if (
    !object(value.notes) ||
    Object.keys(value.notes).length > 100 ||
    !Object.entries(value.notes).every(
      ([key, note]) => id(key) && boundedString(note, 2000),
    )
  ) {
    return invalid(
      "Notes need valid provider IDs and at most 2,000 characters each (100 notes maximum).",
    );
  }
  if (!Array.isArray(value.tasks) || value.tasks.length > 100)
    return invalid("Use at most 100 tasks.");
  const taskIds = new Set<string>();
  for (const task of value.tasks) {
    if (
      !object(task) ||
      !keys(task, [
        "id",
        "title",
        "category",
        "dueDate",
        "status",
        "providerId",
      ]) ||
      !id(task.id) ||
      taskIds.has(task.id) ||
      !boundedString(task.title, 200, 1) ||
      !boundedString(task.category, 80, 1) ||
      !date(task.dueDate) ||
      !(task.status === "todo" || task.status === "done") ||
      !(task.providerId === undefined || id(task.providerId))
    ) {
      return invalid(
        "Tasks need distinct IDs, a title/category, a valid date or empty date, and todo/done status.",
      );
    }
    taskIds.add(task.id);
  }
  let outreach: OutreachRecord[] | undefined;
  if (value.outreach !== undefined) {
    if (!Array.isArray(value.outreach) || value.outreach.length > 100)
      return invalid("Use at most 100 outreach records.");
    outreach = [];
    const requests = new Set<string>();
    for (const valueRecord of value.outreach) {
      const record = parseOutreachRecord(valueRecord);
      if (!record || requests.has(record.brief.requestId))
        return invalid("Outreach records need valid, distinct requests.");
      requests.add(record.brief.requestId);
      outreach.push(record);
    }
  }
  if (
    typeof value.updatedAt !== "string" ||
    value.updatedAt.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value.updatedAt) ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return invalid("updatedAt must be an ISO timestamp.");
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_WORKSPACE_BYTES
  ) {
    return invalid("Workspace exceeds the 128 KiB limit.");
  }
  // Copy the accepted shape; never retain attacker-controlled object prototypes or extra fields.
  return {
    ok: true,
    workspace: {
      profile: {
        name: p.name,
        relationship: p.relationship,
        zip: p.zip,
        careTypes: [...p.careTypes] as string[],
      },
      savedProviderIds: [...value.savedProviderIds] as string[],
      notes: Object.fromEntries(Object.entries(value.notes)) as Record<
        string,
        string
      >,
      tasks: value.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        category: task.category,
        dueDate: task.dueDate,
        status: task.status,
        ...(task.providerId === undefined
          ? {}
          : { providerId: task.providerId }),
      })) as WorkspaceTask[],
      updatedAt: value.updatedAt,
      ...(outreach === undefined ? {} : { outreach }),
    },
  };
}

/** Only same-origin app paths; reject encoded slashes/backslashes and auth redirect loops. */
export function safeRelativeRedirect(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value) ||
    /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|20|7f)/i.test(value)
  )
    return fallback;
  try {
    const parsed = new URL(value, "https://harbor.invalid");
    if (
      parsed.origin !== "https://harbor.invalid" ||
      parsed.pathname.startsWith("/auth/") ||
      parsed.pathname.startsWith("/api/")
    )
      return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
