import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  isWorkspaceOwner,
  parseAccountSnapshot,
  type AccountSnapshot,
} from "./account-workspace";
import { validateWorkspace, type Workspace } from "./workspace";

type Phase =
  | "loading"
  | "idle"
  | "saving"
  | "failed"
  | "conflict"
  | "account-changed"
  | "closed";
export type WorkspaceView = {
  workspace: Workspace;
  ready: boolean;
  error: string;
  saveStatus: string;
  email: string;
  owner: string | null;
  conflict: boolean;
  dirty: boolean;
};

type Dependencies = {
  createClient: () => Promise<Pick<SupabaseClient, "auth">>;
  fetch: typeof fetch;
  fresh: (name?: string) => Workspace;
  publish: (view: WorkspaceView) => void;
  signedOut: () => void;
};

class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class AccountWorkspaceSession {
  private phase: Phase = "loading";
  private generation = 0;
  private active: {
    generation: number;
    controller: AbortController;
    kind: "load" | "save";
  } | null = null;
  private committed: AccountSnapshot | null = null;
  private pending: Workspace | null = null;
  private identity: User | null = null;
  private client: Pick<SupabaseClient, "auth"> | null = null;
  private observedOwner: string | null | undefined;
  private unsubscribe: (() => void) | undefined;
  private error = "";
  private value: Workspace;

  constructor(private readonly dependencies: Dependencies) {
    this.value = dependencies.fresh();
  }

  private emit() {
    if (this.phase === "closed") return;
    this.dependencies.publish({
      workspace: this.value,
      ready: this.committed !== null && this.phase !== "account-changed",
      error: this.error,
      saveStatus:
        this.phase === "saving"
          ? "Saving…"
          : this.phase === "conflict"
            ? "Workspace conflict"
            : this.phase === "account-changed"
              ? "Account changed"
              : this.phase === "failed"
                ? "Changes not saved"
                : this.committed
                  ? this.committed.revision === null
                    ? "Ready to start"
                    : "Saved to your account"
                  : "",
      email: this.committed ? this.identity?.email || "" : "",
      owner: this.committed?.owner || null,
      conflict: this.phase === "conflict",
      dirty: this.pending !== null,
    });
  }

  private cancel() {
    this.generation++;
    this.active?.controller.abort();
    this.active = null;
  }

  private blocked() {
    return this.phase === "closed" || this.phase === "account-changed";
  }

  private accountChanged() {
    if (this.blocked()) return;
    this.cancel();
    this.phase = "account-changed";
    this.committed = null;
    this.pending = null;
    this.identity = null;
    this.value = this.dependencies.fresh();
    this.error = "Your account changed. Reload this page before continuing.";
    this.emit();
    this.dependencies.signedOut();
  }

  async start() {
    const generation = this.generation;
    try {
      const client = await this.dependencies.createClient();
      if (this.blocked() || generation !== this.generation) return;
      this.client = client;
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        if (this.blocked()) return;
        const owner = session?.user.id ?? null;
        if (
          (this.observedOwner !== undefined && owner !== this.observedOwner) ||
          (this.identity && owner !== this.identity.id) ||
          owner === null
        ) {
          this.accountChanged();
          return;
        }
        this.observedOwner = owner;
      });
      this.unsubscribe = () => subscription.unsubscribe();
      const {
        data: { user },
        error,
      } = await client.auth.getUser();
      if (this.blocked() || generation !== this.generation) return;
      if (error?.name === "AuthRetryableFetchError") throw error;
      if (error || !user) {
        this.accountChanged();
        return;
      }
      if (this.observedOwner !== undefined && this.observedOwner !== user.id) {
        this.accountChanged();
        return;
      }
      this.identity = user;
      this.observedOwner = user.id;
      await this.loadLatest();
    } catch (error) {
      if (this.blocked() || generation !== this.generation) return;
      this.phase = "failed";
      this.error =
        error instanceof Error
          ? error.message
          : "Your workspace could not be loaded.";
      this.emit();
    }
  }

  private request(kind: "load" | "save") {
    const request = {
      generation: ++this.generation,
      controller: new AbortController(),
      kind,
    };
    this.active = request;
    return request;
  }

  private current(request: NonNullable<AccountWorkspaceSession["active"]>) {
    return (
      !this.blocked() &&
      this.active === request &&
      this.generation === request.generation
    );
  }

  private async readResponse(response: Response) {
    const body: unknown = await response.json().catch(() => null);
    const code =
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
        ? body.code
        : "";
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Your workspace request failed. Please retry.";
      throw new WorkspaceRequestError(
        message,
        code === "OWNER_MISMATCH"
          ? code
          : response.status === 409
            ? "CONFLICT"
            : code,
      );
    }
    return parseAccountSnapshot(body);
  }

  async loadLatest(): Promise<boolean> {
    if (this.blocked() || !this.identity || this.active?.kind === "save")
      return false;
    const wasConflict = this.phase === "conflict";
    this.cancel();
    const request = this.request("load");
    try {
      const response = await this.dependencies.fetch("/api/workspace", {
        cache: "no-store",
        signal: request.controller.signal,
      });
      const snapshot = await this.readResponse(response);
      if (!this.current(request)) return false;
      if (
        snapshot.owner !== this.identity?.id ||
        (this.committed && snapshot.owner !== this.committed.owner)
      ) {
        this.accountChanged();
        return false;
      }
      this.committed = snapshot;
      this.pending = null;
      this.value =
        snapshot.workspace ||
        this.dependencies.fresh(
          typeof this.identity.user_metadata?.display_name === "string"
            ? this.identity.user_metadata.display_name.slice(0, 80)
            : "",
        );
      this.phase = "idle";
      this.error = "";
      return true;
    } catch (error) {
      if (!this.current(request)) return false;
      if (
        error instanceof WorkspaceRequestError &&
        error.code === "OWNER_MISMATCH"
      ) {
        this.accountChanged();
        return false;
      }
      this.phase = wasConflict ? "conflict" : "failed";
      this.error =
        error instanceof Error
          ? error.message
          : "Your workspace could not be loaded.";
      return false;
    } finally {
      if (this.current(request)) {
        this.active = null;
        this.emit();
      }
    }
  }

  canImportDemo(): boolean {
    return (
      this.phase === "idle" &&
      this.active === null &&
      this.pending === null &&
      this.committed !== null &&
      this.committed.revision === null &&
      this.committed.workspace === null &&
      isWorkspaceOwner(this.committed.owner) &&
      this.identity?.id === this.committed.owner &&
      this.observedOwner === this.committed.owner
    );
  }

  async importDemo(readDemo: () => Workspace | null): Promise<boolean> {
    if (!this.canImportDemo() || !this.client) return false;
    const owner = this.committed!.owner;
    const generation = this.generation;
    try {
      const {
        data: { user },
        error,
      } = await this.client.auth.getUser();
      if (generation !== this.generation || !this.canImportDemo()) return false;
      if (error) {
        this.setError("Your account could not be verified. Please try again.");
        return false;
      }
      if (!user || user.id !== owner) {
        this.accountChanged();
        return false;
      }
      const demo = readDemo();
      if (!demo || !this.canImportDemo()) return false;
      const checked = validateWorkspace({
        ...demo,
        updatedAt: new Date().toISOString(),
      });
      if (!checked.ok) return false;
      this.pending = checked.workspace;
      this.value = checked.workspace;
      return await this.save();
    } catch {
      if (generation === this.generation && !this.blocked())
        this.setError("The demo plan could not be imported. Please try again.");
      return false;
    }
  }

  update(updater: (workspace: Workspace) => Workspace): boolean {
    if (
      this.blocked() ||
      !this.committed ||
      this.phase === "conflict" ||
      this.active?.kind === "load"
    )
      return false;
    try {
      const checked = validateWorkspace({
        ...updater(structuredClone(this.value)),
        updatedAt: new Date().toISOString(),
      });
      if (!checked.ok) throw new Error(checked.error);
      this.pending = checked.workspace;
      this.value = checked.workspace;
      this.emit();
      if (this.phase !== "failed") void this.save();
      return true;
    } catch (error) {
      this.setError(
        error instanceof Error
          ? error.message
          : "Your change could not be applied.",
      );
      return false;
    }
  }

  retrySave() {
    if (
      this.phase !== "failed" ||
      !this.committed ||
      !this.pending ||
      this.active
    )
      return;
    this.phase = "idle";
    void this.save();
  }

  private async save(): Promise<boolean> {
    if (
      this.phase !== "idle" ||
      this.active ||
      !this.pending ||
      !this.committed
    )
      return false;
    const pending = this.pending;
    const committed = this.committed;
    const request = this.request("save");
    this.phase = "saving";
    this.emit();
    try {
      const response = await this.dependencies.fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: request.controller.signal,
        body: JSON.stringify({
          workspace: pending,
          expectedOwner: committed.owner,
          expectedRevision: committed.revision,
        }),
      });
      const snapshot = await this.readResponse(response);
      if (!this.current(request)) return false;
      if (snapshot.owner !== committed.owner) {
        this.accountChanged();
        return false;
      }
      if (
        !snapshot.workspace ||
        snapshot.revision === null ||
        snapshot.revision === committed.revision
      )
        throw new Error("Invalid saved workspace response.");
      this.committed = snapshot;
      if (this.pending === pending) {
        this.pending = null;
        this.value = snapshot.workspace;
      }
      this.phase = "idle";
      this.error = "";
      return true;
    } catch (error) {
      if (!this.current(request)) return false;
      if (
        error instanceof WorkspaceRequestError &&
        error.code === "OWNER_MISMATCH"
      ) {
        this.accountChanged();
        return false;
      }
      this.phase =
        error instanceof WorkspaceRequestError && error.code === "CONFLICT"
          ? "conflict"
          : "failed";
      this.error =
        error instanceof Error ? error.message : "Could not save your changes.";
      return false;
    } finally {
      if (this.current(request)) {
        this.active = null;
        this.emit();
        if (this.phase === "idle" && this.pending) void this.save();
      }
    }
  }

  setError(error: string) {
    if (this.blocked()) return;
    this.error = error;
    this.emit();
  }

  dispose() {
    this.cancel();
    this.phase = "closed";
    this.pending = null;
    this.committed = null;
    this.identity = null;
    this.client = null;
    this.unsubscribe?.();
  }
}
