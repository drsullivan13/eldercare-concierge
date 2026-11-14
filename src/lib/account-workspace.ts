import { validateWorkspace, type Workspace } from "./workspace";

export type AccountSnapshot = {
  owner: string;
  revision: string | null;
  workspace: Workspace | null;
};

export function isWorkspaceOwner(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function revisionMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  const day = match[1].slice(0, 10);
  if (
    !Number.isFinite(millis) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
  )
    return null;
  return (
    BigInt(millis) * BigInt(1000) + BigInt((match[2] || "").padEnd(6, "0"))
  );
}

export function isWorkspaceRevision(value: unknown): value is string {
  return revisionMicros(value) !== null;
}

export function nextWorkspaceRevision(
  previous: string | null,
  now = Date.now(),
): string {
  const prior = previous === null ? null : revisionMicros(previous);
  if (previous !== null && prior === null) throw new Error("Invalid revision.");
  const clock = BigInt(now) * BigInt(1000);
  const next = prior !== null && prior >= clock ? prior + BigInt(1) : clock;
  const timestamp = new Date(Number(next / BigInt(1000))).toISOString();
  return (
    timestamp.slice(0, 19) +
    "." +
    (next % BigInt(1000000)).toString().padStart(6, "0") +
    "Z"
  );
}

export function parseAccountSnapshot(value: unknown): AccountSnapshot {
  if (
    typeof value !== "object" ||
    value === null ||
    !("owner" in value) ||
    !isWorkspaceOwner(value.owner) ||
    !("revision" in value) ||
    !(value.revision === null || isWorkspaceRevision(value.revision)) ||
    !("workspace" in value)
  )
    throw new Error("Invalid workspace response.");
  if (value.revision === null && value.workspace === null)
    return { owner: value.owner, revision: null, workspace: null };
  const checked = validateWorkspace(value.workspace);
  if (value.revision === null || !checked.ok)
    throw new Error("Invalid workspace response.");
  return {
    owner: value.owner,
    revision: value.revision,
    workspace: checked.workspace,
  };
}
