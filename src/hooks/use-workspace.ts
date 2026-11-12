"use client";
import { legacyMarket } from "@/lib/market-registration";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { validateWorkspace, type Workspace } from "@/lib/workspace";
const DEMO_KEY = "harbor.demo.workspace.v1";
function makeWorkspace(name = "", demo = false): Workspace {
  return {
    profile: {
      name,
      relationship: "A parent",
      zip: demo ? legacyMarket.defaultZip : "",
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
export function useWorkspace(demo: boolean) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    makeWorkspace("", demo),
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [email, setEmail] = useState("");
  const current = useRef(workspace);
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        if (demo) {
          let value = makeWorkspace("", true);
          let storedLocally = false;
          try {
            const stored = localStorage.getItem(DEMO_KEY);
            if (stored) {
              const candidate = validateWorkspace(JSON.parse(stored));
              if (candidate.ok) value = candidate.workspace;
              else
                setError(
                  "The previous demo plan could not be restored. A fresh workspace is ready.",
                );
            }
            localStorage.setItem(DEMO_KEY, JSON.stringify(value));
            storedLocally = true;
          } catch {
            setError(
              "This browser could not store your plan. Enable site storage to save changes; you can still search for care.",
            );
          }
          if (active) {
            current.current = value;
            setWorkspace(value);
            setReady(true);
            setSaveStatus(
              storedLocally ? "Saved in this browser" : "Demo not saved",
            );
          }
          return;
        }
        if (!isSupabaseConfigured()) {
          router.replace("/signup");
          return;
        }
        const supabase = await createClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError || !user) {
          router.replace("/login");
          return;
        }
        const res = await fetch("/api/workspace", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok)
          throw new Error(body.error || "Your workspace could not be loaded.");
        const value =
          body.workspace ||
          makeWorkspace(
            typeof user.user_metadata?.display_name === "string"
              ? user.user_metadata.display_name.slice(0, 80)
              : "",
          );
        const checked = validateWorkspace(value);
        if (!checked.ok)
          throw new Error(
            "Your stored workspace needs attention. Please try again later.",
          );
        if (active) {
          current.current = checked.workspace;
          setWorkspace(checked.workspace);
          setEmail(user.email || "");
          setReady(true);
          setSaveStatus(
            body.workspace ? "Saved to your account" : "Ready to start",
          );
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Your workspace could not be loaded.",
          );
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [demo, router]);
  const persist = useCallback((value: Workspace) => {
    const version = ++revision.current;
    setSaveStatus("Saving…");
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: value }),
        });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "Could not save your changes.");
        }
        if (version === revision.current) {
          setSaveStatus("Saved to your account");
          setError("");
        }
      } catch (e) {
        if (version === revision.current) {
          setSaveStatus("Changes not saved");
          setError(
            e instanceof Error ? e.message : "Could not save your changes.",
          );
        }
      }
    });
  }, []);
  const update = useCallback(
    (updater: (value: Workspace) => Workspace): boolean => {
      const checked = validateWorkspace({
        ...updater(current.current),
        updatedAt: new Date().toISOString(),
      });
      if (!checked.ok) {
        setError(checked.error);
        return false;
      }
      if (demo) {
        try {
          localStorage.setItem(DEMO_KEY, JSON.stringify(checked.workspace));
          setSaveStatus("Saved in this browser");
          setError("");
        } catch {
          setError(
            "Your browser could not save this change. Export your current plan before leaving.",
          );
          return false;
        }
      } else persist(checked.workspace);
      current.current = checked.workspace;
      setWorkspace(checked.workspace);
      return true;
    },
    [demo, persist],
  );
  useEffect(() => {
    if (
      demo ||
      (saveStatus !== "Saving…" && saveStatus !== "Changes not saved")
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [demo, saveStatus]);
  return {
    workspace,
    update,
    ready,
    error,
    setError,
    saveStatus,
    email,
    retrySave: () => persist(current.current),
  };
}
