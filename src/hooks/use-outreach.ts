"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createOutreachRecord,
  mergeOutreach,
  outreachPending,
  outreachUrl,
  parseOutreachResult,
  type OutreachProvider,
  type OutreachRecord,
} from "@/lib/outreach";
import { validateWorkspace, type Workspace } from "@/lib/workspace";

const DEMO_KEY = "harbor.demo.workspace.v1";
const POLL_MS = 15_000;
type Update = (updater: (workspace: Workspace) => Workspace) => boolean;

export function useOutreach(
  workspace: Workspace,
  update: Update,
  ready: boolean,
  demo = false,
) {
  const mode = demo ? "demo" : "account";
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(workspace);
  const generation = useRef(0);
  const active = useRef(false);
  const running = useRef<{ generation: number; task: Promise<void> } | null>(
    null,
  );
  const retry = useRef(new Map<string, { failures: number; after: number }>());
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    current.current = workspace;
  }, [workspace]);
  useEffect(() => {
    active.current = ready;
    const epoch = ++generation.current;
    const requests = controllers.current;
    const backoff = retry.current;
    return () => {
      active.current = false;
      generation.current = epoch + 1;
      setRefreshing(false);
      backoff.clear();
      for (const controller of requests) controller.abort();
    };
  }, [ready, demo, update]);

  const snapshot = useCallback(() => {
    const local = current.current;
    if (!demo) return local;
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return local;
    const checked = validateWorkspace(JSON.parse(raw));
    if (!checked.ok) throw new Error("Invalid demo workspace.");
    return {
      ...checked.workspace,
      outreach: mergeOutreach(
        local.outreach ?? [],
        checked.workspace.outreach ?? [],
      ),
    };
  }, [demo]);

  const save = useCallback(
    (incoming: OutreachRecord[]) => {
      const base = snapshot();
      const outreach = mergeOutreach(base.outreach ?? [], incoming);
      const checked = validateWorkspace({ ...base, outreach });
      if (!checked.ok) throw new Error(checked.error);
      if (
        JSON.stringify({ ...checked.workspace, updatedAt: "" }) !==
        JSON.stringify({ ...current.current, updatedAt: "" })
      ) {
        if (!update(() => checked.workspace))
          throw new Error("Outreach could not be saved.");
        current.current = checked.workspace;
      }
      return outreach;
    },
    [snapshot, update],
  );

  const refresh = useCallback(
    (force = true): Promise<void> => {
      if (!ready || !active.current) return Promise.resolve();
      const epoch = generation.current;
      if (running.current?.generation === epoch) return running.current.task;
      const valid = () => active.current && generation.current === epoch;
      const run = async () => {
        const pending = (snapshot().outreach ?? []).filter(
          (record) =>
            record.state !== "completed" &&
            (force ||
              (retry.current.get(record.brief.requestId)?.after ?? 0) <=
                Date.now()),
        );
        if (!pending.length) return;
        setRefreshing(true);
        setError("");
        let index = 0;
        const worker = async () => {
          while (valid() && index < pending.length) {
            const record = pending[index++];
            const { requestId, readKey } = record.brief;
            const controller = new AbortController();
            controllers.current.add(controller);
            const timeout = setTimeout(() => controller.abort(), 10_000);
            let failures = retry.current.get(requestId)?.failures ?? 0;
            try {
              const response = await fetch("/api/outreach-result", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId, readKey }),
                cache: "no-store",
                credentials: "same-origin",
                redirect: "error",
                signal: controller.signal,
              });
              if (!valid() || controller.signal.aborted) return;
              if (response.status === 404) failures++;
              else {
                if (!response.ok) throw new Error("Refresh failed.");
                const result = parseOutreachResult(await response.json());
                if (!result) throw new Error("Invalid outreach result.");
                if (!valid() || controller.signal.aborted) return;
                const trusted = current.current.outreach?.find(
                  (item) =>
                    item.brief.requestId === requestId &&
                    item.brief.readKey === readKey,
                );
                if (trusted) save([{ ...trusted, ...result }]);
                failures = 0;
              }
            } catch {
              if (!valid()) return;
              failures++;
              setError(
                "Outreach results could not be refreshed. Your saved requests are safe.",
              );
            } finally {
              clearTimeout(timeout);
              controllers.current.delete(controller);
            }
            if (valid())
              retry.current.set(requestId, {
                failures: Math.min(failures, 4),
                after: Date.now() + Math.min(POLL_MS * 2 ** failures, 120_000),
              });
          }
        };
        await Promise.all([worker(), worker()]);
      };
      const task = run()
        .catch(() => {
          if (valid())
            setError("Your browser could not restore saved outreach.");
        })
        .finally(() => {
          if (running.current?.task === task) {
            running.current = null;
            if (valid()) setRefreshing(false);
          }
        });
      running.current = { generation: epoch, task };
      return task;
    },
    [ready, snapshot, save],
  );

  useEffect(() => {
    if (!ready) return;
    const poll = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (
        !demo ||
        event.key !== DEMO_KEY ||
        (event.storageArea && event.storageArea !== localStorage)
      )
        return;
      try {
        save([]);
      } catch {
        setError("Your browser could not restore saved outreach.");
      }
    };
    if (demo) window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const interval = setInterval(poll, POLL_MS);
    poll();
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [ready, demo, refresh, save]);

  const reopen = useCallback(
    (record: OutreachRecord) => {
      if (!ready) return;
      try {
        const trusted = snapshot().outreach?.find(
          (item) =>
            item.brief.requestId === record.brief.requestId &&
            item.state !== "completed",
        );
        if (!trusted) return;
        window.open(
          outreachUrl(trusted.brief, mode),
          "_blank",
          "noopener,noreferrer",
        );
        setError("");
      } catch {
        setError(
          "The rehearsal could not be opened. Reopen the saved request to retry.",
        );
      }
    },
    [ready, snapshot, mode],
  );

  const launch = useCallback(
    (
      provider: OutreachProvider,
      topics: string[],
      question: string,
      parent?: OutreachRecord,
    ): boolean => {
      if (!ready) return false;
      try {
        const restored = snapshot().outreach ?? [];
        const trustedParent = parent
          ? restored.find(
              (item) =>
                item.brief.requestId === parent.brief.requestId &&
                item.brief.providerId === provider.providerId,
            )
          : undefined;
        if (parent && !trustedParent)
          throw new Error("Unknown prior rehearsal.");
        const record = createOutreachRecord(
          provider,
          topics,
          question,
          trustedParent,
        );
        const existing = restored.find(
          (item) =>
            outreachPending(item) &&
            item.brief.providerId === record.brief.providerId &&
            item.brief.phone === record.brief.phone &&
            item.brief.question === record.brief.question &&
            JSON.stringify([...item.brief.topics].sort()) ===
              JSON.stringify([...record.brief.topics].sort()) &&
            item.parentId === record.parentId,
        );
        const target = existing ?? record;
        save([target]);
        window.open(
          outreachUrl(target.brief, mode),
          "_blank",
          "noopener,noreferrer",
        );
        setError("");
        return true;
      } catch {
        setError(
          "The rehearsal could not be started. Check your input and workspace storage.",
        );
        return false;
      }
    },
    [ready, snapshot, save, mode],
  );

  return {
    records: workspace.outreach ?? [],
    launch,
    refresh,
    refreshing,
    error,
    reopen,
  };
}
