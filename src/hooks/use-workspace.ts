"use client";
import { DEFAULT_DASHBOARD_SEARCH_ZIP } from "@/lib/dashboard-defaults";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { validateWorkspace, type Workspace } from "@/lib/workspace";
import {
  AccountWorkspaceSession,
  type WorkspaceView,
} from "@/lib/account-workspace-session";
import { parseDemoImport } from "@/lib/demo-workspace-import";

const DEMO_KEY = "harbor.demo.workspace.v1";
function makeWorkspace(name = "", demo = false): Workspace {
  return {
    profile: {
      name,
      relationship: "A parent",
      zip: demo ? DEFAULT_DASHBOARD_SEARCH_ZIP : "",
      careTypes: [],
    },
    savedProviderIds: [],
    notes: {},
    tasks: [
      {
        id: "starter-needs",
        title: "Talk through care preferences and must-haves",
        category: "Care",
        dueDate: "",
        status: "todo",
      },
      {
        id: "starter-shortlist",
        title: "Choose a few care options to look into",
        category: "Research",
        dueDate: "",
        status: "todo",
      },
      {
        id: "starter-costs",
        title: "List the questions to ask about costs and coverage",
        category: "Finances",
        dueDate: "",
        status: "todo",
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

type Lifecycle =
  | { demo: true; active: boolean; workspace: Workspace }
  | {
      demo: false;
      session: AccountWorkspaceSession;
      demoImportChecked: boolean;
    };

function readDemoImport(): Workspace | null {
  try {
    return parseDemoImport(
      localStorage.getItem(DEMO_KEY),
      makeWorkspace("", true),
    );
  } catch {
    return null;
  }
}

function initialView(demo: boolean): WorkspaceView {
  return {
    workspace: makeWorkspace("", demo),
    ready: false,
    error: "",
    saveStatus: "",
    email: "",
    owner: null,
    conflict: false,
    dirty: false,
  };
}

export function useWorkspace(demo: boolean) {
  const router = useRouter();
  const [state, setState] = useState<{
    demo: boolean;
    view: WorkspaceView;
    lifecycle: Lifecycle | null;
  }>(() => ({
    demo,
    view: initialView(demo),
    lifecycle: null,
  }));
  const [checkedDemoSession, setCheckedDemoSession] =
    useState<AccountWorkspaceSession | null>(null);
  const lifecycle = useRef<Lifecycle | null>(null);
  const view = state.demo === demo ? state.view : initialView(demo);
  const bound = state.demo === demo ? state.lifecycle : null;

  useEffect(() => {
    if (demo) {
      const local: Extract<Lifecycle, { demo: true }> = {
        demo: true,
        active: true,
        workspace: makeWorkspace("", true),
      };
      lifecycle.current = local;
      let error = "";
      let storedLocally = false;
      try {
        const stored = localStorage.getItem(DEMO_KEY);
        if (stored) {
          const candidate = validateWorkspace(JSON.parse(stored));
          if (candidate.ok) local.workspace = candidate.workspace;
          else
            error =
              "The previous demo plan could not be restored. A fresh workspace is ready.";
        }
        localStorage.setItem(DEMO_KEY, JSON.stringify(local.workspace));
        storedLocally = true;
      } catch {
        error =
          "This browser could not store your plan. Enable site storage to save changes; you can still search for care.";
      }
      setState({
        demo,
        lifecycle: local,
        view: {
          ...initialView(true),
          workspace: local.workspace,
          ready: true,
          error,
          saveStatus: storedLocally
            ? "Saved in this browser"
            : "Demo not saved",
        },
      });
      return () => {
        local.active = false;
        if (lifecycle.current === local) lifecycle.current = null;
      };
    }
    const session = new AccountWorkspaceSession({
      createClient: async () => {
        if (!isSupabaseConfigured()) {
          router.replace("/signup");
          throw new Error("Cloud workspace is not configured.");
        }
        return createClient();
      },
      fetch: (...args) => fetch(...args),
      fresh: makeWorkspace,
      publish: (next) => {
        if (lifecycle.current === cloud)
          setState({ demo: false, view: next, lifecycle: cloud });
      },
      signedOut: () => router.replace("/login"),
    });
    const cloud: Extract<Lifecycle, { demo: false }> = {
      demo: false,
      session,
      demoImportChecked: false,
    };
    lifecycle.current = cloud;
    setState({ demo: false, view: initialView(false), lifecycle: cloud });
    void session.start();
    return () => {
      session.dispose();
      if (lifecycle.current === cloud) lifecycle.current = null;
    };
  }, [demo, router]);

  const update = useCallback(
    (updater: (workspace: Workspace) => Workspace): boolean => {
      const current = lifecycle.current;
      if (!current || current !== bound || current.demo !== demo) return false;
      if (!current.demo) return current.session.update(updater);
      if (!current.active) return false;
      try {
        const checked = validateWorkspace({
          ...updater(structuredClone(current.workspace)),
          updatedAt: new Date().toISOString(),
        });
        if (!checked.ok) throw new Error(checked.error);
        try {
          localStorage.setItem(DEMO_KEY, JSON.stringify(checked.workspace));
        } catch {
          throw new Error(
            "Your browser could not save this change. Export your current plan before leaving.",
          );
        }
        current.workspace = checked.workspace;
        setState((previous) => ({
          demo: true,
          lifecycle: current,
          view: {
            ...previous.view,
            workspace: checked.workspace,
            error: "",
            saveStatus: "Saved in this browser",
          },
        }));
        return true;
      } catch (error) {
        setState((previous) => ({
          ...previous,
          view: {
            ...previous.view,
            error:
              error instanceof Error
                ? error.message
                : "Your change could not be applied.",
          },
        }));
        return false;
      }
    },
    [bound, demo],
  );

  const retrySave = useCallback(() => {
    const current = lifecycle.current;
    if (!demo && current && current === bound && !current.demo)
      current.session.retrySave();
  }, [bound, demo]);
  const loadLatest = useCallback(async (): Promise<boolean> => {
    const current = lifecycle.current;
    if (!demo && current && current === bound && !current.demo)
      return current.session.loadLatest();
    return false;
  }, [bound, demo]);
  const checkDemoImport = useCallback((): boolean => {
    const current = lifecycle.current;
    if (demo || !current || current !== bound || current.demo) return false;
    const eligible =
      current.session.canImportDemo() && readDemoImport() !== null;
    current.demoImportChecked = eligible;
    setCheckedDemoSession(eligible ? current.session : null);
    return eligible;
  }, [bound, demo]);
  const importDemo = useCallback(async (): Promise<boolean> => {
    const current = lifecycle.current;
    if (
      demo ||
      !current ||
      current !== bound ||
      current.demo ||
      !current.demoImportChecked
    )
      return false;
    current.demoImportChecked = false;
    setCheckedDemoSession(null);
    return current.session.importDemo(readDemoImport);
  }, [bound, demo]);
  const setError = useCallback(
    (error: string) => {
      const current = lifecycle.current;
      if (!current || current !== bound || current.demo !== demo) return;
      if (!current.demo) current.session.setError(error);
      else if (current.active)
        setState((previous) => ({
          ...previous,
          view: { ...previous.view, error },
        }));
    },
    [bound, demo],
  );

  useEffect(() => {
    if (demo || !view.dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [demo, view.dirty]);

  const current = lifecycle.current;
  const canImportDemo =
    !demo &&
    current !== null &&
    current === bound &&
    !current.demo &&
    checkedDemoSession === current.session &&
    current.demoImportChecked &&
    current.session.canImportDemo();

  return {
    ...view,
    update,
    setError,
    retrySave,
    loadLatest,
    checkDemoImport,
    canImportDemo,
    importDemo,
  };
}
