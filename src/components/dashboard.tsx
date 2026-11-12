"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Columns2,
  Info,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCareSearch } from "@/hooks/use-care-search";
import { useSavedProviders } from "@/hooks/use-saved-providers";
import { createClient } from "@/lib/supabase/client";
import type { Provider, SearchProvider } from "@/lib/providers";
import { Brand } from "./brand";
import { ProviderCard } from "./provider-card";
import { ProviderDetail } from "./provider-detail";
import { Overview } from "./dashboard/overview";
import { CareSearchView } from "./dashboard/care-search";
import { ShortlistView } from "./dashboard/shortlist";
import { PlanView } from "./dashboard/plan";
import { ComparisonTray, useComparison } from "./dashboard/compare-dialog";
import { ProfileDialog } from "./dashboard/profile-dialog";
import { EvidenceStandards } from "./dashboard/research-standards";
import { carePlanText } from "./dashboard/export-plan";
import "./dashboard/dashboard.css";

type View = "overview" | "search" | "shortlist" | "plan" | "standards";
const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "search", label: "Find care", icon: Search },
  { id: "shortlist", label: "Your shortlist", icon: Bookmark },
  { id: "plan", label: "Your plan", icon: ClipboardList },
] as const;
export function Dashboard({ demo }: { demo: boolean }) {
  const state = useWorkspace(demo);
  if (!state.ready)
    return (
      <div className="loading-screen">
        <Brand />
        <Loader2 className="spin" />
        <p>{state.error || "Opening your care workspace…"}</p>
        {state.error && (
          <button
            className="button button-outline"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        )}
      </div>
    );
  return <WorkspaceDashboard demo={demo} state={state} />;
}
function WorkspaceDashboard({
  demo,
  state,
}: {
  demo: boolean;
  state: ReturnType<typeof useWorkspace>;
}) {
  const { workspace, update, error, setError, saveStatus, email, retrySave } =
    state;
  const router = useRouter();
  const [view, setView] = useState<View>("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const search = useCareSearch(workspace.profile);
  const { data } = search;
  const saved = useSavedProviders(workspace.savedProviderIds);
  const savedProviders = saved.providers;
  const [selected, setSelected] = useState<Provider | null>(null);
  const comparison = useComparison();
  const [profileOpen, setProfileOpen] = useState(
    !demo && !workspace.profile.zip,
  );
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);
  const selectedProvider = selected;
  const openProvider = useCallback(
    (provider: Provider) => setSelected(provider),
    [],
  );
  const savedSet = useMemo(
    () => new Set(workspace.savedProviderIds),
    [workspace.savedProviderIds],
  );
  function navigate(next: View) {
    setView(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function saveProvider(provider: Provider) {
    const saved = savedSet.has(provider.id);
    if (
      update((w) => ({
        ...w,
        savedProviderIds: saved
          ? w.savedProviderIds.filter((id) => id !== provider.id)
          : [...w.savedProviderIds, provider.id],
      }))
    )
      setToast(
        saved ? "Removed from your shortlist" : "Added to your shortlist",
      );
  }
  function submitSearch() {
    comparison.clear();
    search.run();
    navigate("search");
  }
  function addTask(
    title: string,
    providerId?: string,
    category = "Care",
    dueDate = "",
  ) {
    const accepted = update((w) => ({
      ...w,
      tasks: [
        ...w.tasks,
        {
          id: crypto.randomUUID(),
          title,
          category,
          dueDate,
          status: "todo",
          ...(providerId ? { providerId } : {}),
        },
      ],
    }));
    if (accepted) setToast("Added to your plan");
    return accepted;
  }
  function exportPlan() {
    const text = carePlanText(
      workspace,
      [...savedProviders, ...(data?.providers ?? [])],
      search.request.zip,
    );
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "harbor-care-plan.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("Your care plan has been exported.");
  }
  async function signOut() {
    if (
      !demo &&
      saveStatus === "Changes not saved" &&
      !window.confirm(
        "Your latest changes have not been saved. Sign out and discard those changes? You can cancel and export your plan or retry saving.",
      )
    )
      return;
    if (!demo) {
      try {
        const supabase = await createClient();
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } catch {
        setError("Could not sign out. Please try again.");
        return;
      }
    }
    router.push("/");
    router.refresh();
  }
  const cards = (providers: SearchProvider[]) =>
    providers.map((provider) => (
      <ProviderCard
        key={provider.id}
        provider={provider}
        saved={savedSet.has(provider.id)}
        onSave={() => saveProvider(provider)}
        onOpen={() => setSelected(provider)}
        compare={comparison.contains(provider.id)}
        onCompare={() => {
          if (!comparison.toggle(provider))
            setToast("Compare up to three options at a time.");
        }}
      />
    ));
  const comparisonEntry = (
    <section className="comparison-entry" aria-label="Compare care options">
      <Columns2 size={21} aria-hidden="true" />
      <div>
        <strong>Compare care options</strong>
        <p aria-live="polite">
          {comparison.providers.length
            ? `${comparison.providers.length} of 3 selected. Choose at least 2 to compare.`
            : "Select Compare on 2–3 cards to see them side by side."}
        </p>
      </div>
      <button
        className="button button-outline"
        disabled={
          view === "search"
            ? search.loading || !data?.providers.length
            : savedProviders.length === 0
        }
        onClick={() => {
          const target =
            document.querySelector<HTMLElement>(
              ".provider-card .compare-check input:not(:checked)",
            ) ??
            document.querySelector<HTMLElement>(
              ".provider-card .compare-check input",
            );
          if (target) {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
            target.focus({ preventScroll: true });
          }
        }}
      >
        {comparison.providers.length ? "Change selection" : "Choose options"}
        <ArrowUpRight size={15} />
      </button>
    </section>
  );

  return (
    <div
      className={`app-shell${comparison.providers.length && ["search", "shortlist"].includes(view) ? " has-comparison" : ""}`}
    >
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <Brand dark />
        <button
          className="mobile-close icon-button"
          onClick={() => setMobileMenu(false)}
          aria-label="Close menu"
        >
          <X />
        </button>
        <div className="workspace-picker">
          <span className="workspace-icon">
            <Users size={18} />
          </span>
          <div>
            <strong>Your care circle</strong>
            <span>{demo ? "Demo workspace" : "Personal workspace"}</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "shortlist" &&
                workspace.savedProviderIds.length > 0 && (
                  <b>{workspace.savedProviderIds.length}</b>
                )}
            </button>
          ))}
        </nav>
        <button
          className="sidebar-research-link"
          onClick={() => navigate("standards")}
        >
          <ShieldCheck size={17} /> Research standards{" "}
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-bottom">
          <span>
            <span className="live-dot" />{" "}
            {data?.market.label || "ZIP-SELECTED CARE SEARCH"}
          </span>
          <button
            className="profile-button"
            onClick={() => setProfileOpen(true)}
          >
            <div className="avatar">
              {workspace.profile.name ? (
                workspace.profile.name.slice(0, 1).toUpperCase()
              ) : (
                <Users size={17} />
              )}
            </div>
            <div>
              <strong>{workspace.profile.name || "Your workspace"}</strong>
              <span>{demo ? "Saved on this device" : email}</span>
            </div>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="sidebar-overlay"
          aria-label="Close menu"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="app-main">
        <header className="app-topbar">
          <Brand />
          <span className="masthead-context">
            {view === "standards"
              ? "Research standards"
              : NAV.find((n) => n.id === view)?.label}
          </span>
          <button
            className="mobile-menu"
            onClick={() => setMobileMenu(true)}
            aria-label="Open navigation"
            aria-expanded={mobileMenu}
          >
            <Menu size={21} aria-hidden="true" />
            Menu
          </button>
        </header>
        <main id="main-content" className="dashboard-content">
          {(error || saveStatus === "Changes not saved") && (
            <div role="alert" className="form-error page-error">
              {error ||
                "Your latest changes have not been saved. Retry saving or export your plan before leaving."}
              {saveStatus === "Changes not saved" && (
                <button className="text-link" onClick={retrySave}>
                  Retry saving
                </button>
              )}
              {saveStatus !== "Changes not saved" && (
                <button onClick={() => setError("")} aria-label="Dismiss error">
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {view === "overview" && (
            <Overview
              workspace={workspace}
              search={search}
              findCare={submitSearch}
              navigate={navigate}
            />
          )}
          {view === "search" && (
            <CareSearchView
              search={search}
              submit={submitSearch}
              cards={cards}
              openProvider={openProvider}
            />
          )}
          {view === "shortlist" && (
            <>
              {comparisonEntry}
              <ShortlistView
                saved={saved}
                origin={data?.origin}
                cards={cards}
                findCare={() => navigate("search")}
                exportPlan={exportPlan}
              />
            </>
          )}
          {view === "plan" && (
            <PlanView
              workspace={workspace}
              update={update}
              addTask={addTask}
              exportPlan={exportPlan}
            />
          )}
          {view === "standards" && <EvidenceStandards />}
        </main>
        <details className="workspace-details">
          <summary>
            <Info size={18} aria-hidden="true" /> About your workspace
          </summary>
          <div className="workspace-details-content">
            {demo && (
              <p className="demo-banner">
                Demo workspace · Real provider records. Your plan stays in this
                browser.
              </p>
            )}
            <p className="save-status" role="status">
              {saveStatus}
            </p>
            <div className="workspace-details-actions">
              {demo && ACCOUNTS_ENABLED && (
                <Link href="/signup" className="text-link">
                  Create an account <ArrowUpRight size={16} />
                </Link>
              )}
              <button
                className="text-link"
                onClick={signOut}
                disabled={saveStatus === "Saving…"}
              >
                <LogOut size={17} aria-hidden="true" />
                {demo ? "Leave demo" : "Sign out"}
              </button>
            </div>
          </div>
        </details>
        <footer className="app-footer">
          <span>
            harbor. <span>A clearer path to care.</span>
          </span>
          <button onClick={() => navigate("standards")}>
            Sources & research standards <ArrowUpRight size={12} />
          </button>
        </footer>
      </div>
      {["search", "shortlist"].includes(view) && (
        <ComparisonTray comparison={comparison} openProvider={openProvider} />
      )}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {selectedProvider && (
        <ProviderDetail
          key={selectedProvider.id}
          provider={selectedProvider}
          saved={savedSet.has(selectedProvider.id)}
          note={workspace.notes[selectedProvider.id] || ""}
          saveStatus={saveStatus}
          saveError={error}
          onSave={() => saveProvider(selectedProvider)}
          onNote={(note) =>
            update((w) => ({
              ...w,
              notes: { ...w.notes, [selectedProvider.id]: note },
            }))
          }
          onTask={(title) => addTask(title, selectedProvider.id)}
          close={() => setSelected(null)}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          profile={workspace.profile}
          close={() => setProfileOpen(false)}
          save={(profile) => {
            if (update((w) => ({ ...w, profile }))) {
              comparison.clear();
              search.filter({ zip: profile.zip });
              setProfileOpen(false);
              setToast("Your workspace has been updated.");
            }
          }}
        />
      )}
    </div>
  );
}
