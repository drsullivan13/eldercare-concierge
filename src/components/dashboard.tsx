"use client";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Bookmark,
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
import { Modal } from "./modal";
import type { ProfilePane } from "./profile-pane";
import { Overview } from "./dashboard/overview";
import { DemoComparison } from "./dashboard/demo-comparison";
import { CareSearchView } from "./dashboard/care-search";
import { ShortlistView } from "./dashboard/shortlist";
import { PlanView } from "./dashboard/plan";
import { ComparisonTray, useComparison } from "./dashboard/compare-dialog";
import { ProfileDialog } from "./dashboard/profile-dialog";
import { EvidenceStandards } from "./dashboard/research-standards";
import { carePlanText } from "./dashboard/export-plan";
import type { DashboardNotification } from "./dashboard/dashboard-notifications";
import "./dashboard/dashboard.css";

type View = "overview" | "search" | "shortlist" | "plan" | "standards";
const DashboardNotifications = lazy(
  () => import("./dashboard/dashboard-notifications"),
);
const ProviderDetail = lazy(() =>
  import("./provider-detail").then((module) => ({
    default: module.ProviderDetail,
  })),
);
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
  const [isMobile, setIsMobile] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const profileReturnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    function change() {
      const focusInSidebar =
        media.matches && sidebar.current?.contains(document.activeElement);
      setIsMobile(media.matches);
      if (focusInSidebar) {
        requestAnimationFrame(() => {
          const target = menuButton.current;
          if (
            !document.querySelector("dialog:modal") &&
            target &&
            !target.closest("[inert], [hidden]") &&
            target.getClientRects().length > 0 &&
            getComputedStyle(target).visibility === "visible"
          )
            target.focus({ preventScroll: true });
        });
      }
      if (
        !media.matches &&
        sidebar.current?.classList.contains("sidebar-open")
      ) {
        setMobileMenu(false);
        requestAnimationFrame(() => {
          sidebar.current
            ?.querySelector<HTMLElement>('[aria-current="page"]')
            ?.focus();
        });
      }
    }
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (isMobile && mobileMenu)
      sidebar.current?.querySelector<HTMLElement>(".mobile-close")?.focus();
  }, [isMobile, mobileMenu]);
  const search = useCareSearch(workspace.profile);
  const { data } = search;
  const saved = useSavedProviders(workspace.savedProviderIds);
  const savedProviders = saved.providers;
  const [selected, setSelected] = useState<Provider | null>(null);
  const [initialPane, setInitialPane] = useState<ProfilePane>("overview");
  const providerReturnFocus = useRef<HTMLElement | null>(null);
  const comparison = useComparison();
  const [profileOpen, setProfileOpen] = useState(
    !demo && !workspace.profile.zip,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pendingNotifications, setPendingNotifications] = useState<
    DashboardNotification[]
  >([]);
  const shortlistOperations = useRef(new Map<string, symbol>());
  const notify = useCallback(
    (
      title: string,
      options: Omit<DashboardNotification, "id" | "title"> = {},
    ) => {
      const notification = { ...options, id: crypto.randomUUID(), title };
      setPendingNotifications((pending) => [...pending, notification]);
      setNotificationsEnabled(true);
    },
    [],
  );
  const delivered = useCallback((ids: readonly string[]) => {
    const deliveredIds = new Set(ids);
    setPendingNotifications((pending) =>
      pending.filter((notification) => !deliveredIds.has(notification.id)),
    );
  }, []);
  function closeProfile() {
    setProfileOpen(false);
    requestAnimationFrame(() => {
      const trigger = window.matchMedia("(max-width: 760px)").matches
        ? menuButton.current
        : profileReturnFocus.current === menuButton.current
          ? sidebar.current?.querySelector<HTMLElement>(".profile-button")
          : profileReturnFocus.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }
  const selectedProvider = selected;
  const openProvider = useCallback(
    (
      provider: Provider,
      pane: ProfilePane = "overview",
      trigger?: HTMLElement,
    ) => {
      providerReturnFocus.current =
        trigger ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      setInitialPane(pane);
      setSelected(provider);
    },
    [],
  );
  const closeProvider = useCallback(() => {
    setSelected(null);
    const trigger = providerReturnFocus.current;
    requestAnimationFrame(() => {
      if (document.querySelector("dialog:modal")) return;
      const target = [
        trigger,
        main.current?.querySelector<HTMLElement>(".provider-card .save-button"),
        main.current?.querySelector<HTMLElement>(
          "#family-shortlist-heading, h1",
        ),
        main.current,
      ].find(
        (element) =>
          element?.isConnected &&
          !element.closest("[inert], [hidden]") &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === "visible",
      );
      if (target) {
        if (target.tabIndex < 0) target.tabIndex = -1;
        target.focus();
      }
    });
  }, []);
  const savedSet = useMemo(
    () => new Set(workspace.savedProviderIds),
    [workspace.savedProviderIds],
  );
  function navigate(next: View) {
    setView(next);
    setMobileMenu(false);
    requestAnimationFrame(() => {
      const heading = main.current?.querySelector<HTMLElement>("h1");
      const target = heading ?? main.current;
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function closeMenu() {
    setMobileMenu(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  }
  function saveProvider(provider: Provider) {
    let originalIndex = -1;
    const focused = document.activeElement;
    const focusedCard =
      focused instanceof HTMLElement ? focused.closest(".provider-card") : null;
    const accepted = update((w) => {
      originalIndex = w.savedProviderIds.indexOf(provider.id);
      return {
        ...w,
        savedProviderIds:
          originalIndex >= 0
            ? w.savedProviderIds.filter((id) => id !== provider.id)
            : [...w.savedProviderIds, provider.id],
      };
    });
    if (!accepted) return;
    const token = Symbol(provider.id);
    shortlistOperations.current.set(provider.id, token);
    if (originalIndex < 0) {
      notify("Added to your shortlist", { description: provider.name });
      return;
    }
    if (view === "shortlist" && focusedCard) {
      requestAnimationFrame(() => {
        if (focused instanceof HTMLElement && focused.isConnected) return;
        const target = main.current?.querySelector<HTMLElement>(
          ".provider-card .save-button, #family-shortlist-heading",
        );
        if (target) {
          target.tabIndex = target.matches("button") ? 0 : -1;
          target.focus();
        }
      });
    }
    notify("Removed from your shortlist", {
      description: `${provider.name}. Undo is available.`,
      action: {
        label: "Undo",
        onAction: () => {
          if (shortlistOperations.current.get(provider.id) !== token)
            return true;
          const restored = update((w) => {
            if (w.savedProviderIds.includes(provider.id)) return w;
            const ids = [...w.savedProviderIds];
            ids.splice(
              Math.min(Math.max(originalIndex, 0), ids.length),
              0,
              provider.id,
            );
            return { ...w, savedProviderIds: ids };
          });
          if (restored) shortlistOperations.current.delete(provider.id);
          return restored;
        },
      },
    });
  }
  function submitSearch() {
    if (search.draft.zip.trim() !== search.request.zip) comparison.clear();
    search.run();
    if (view !== "search") navigate("search");
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
    if (accepted) notify("Added to your plan", { description: title });
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
    notify("Your care plan has been exported.");
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
        onOpen={() => openProvider(provider)}
        onReviews={(trigger) => openProvider(provider, "reviews", trigger)}
        compare={comparison.contains(provider.id)}
        onCompare={() => {
          if (!comparison.toggle(provider))
            notify("Compare up to three options at a time.");
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
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}
        inert={isMobile && !mobileMenu}
        onKeyDown={(event) => {
          if (
            !isMobile ||
            !mobileMenu ||
            event.defaultPrevented ||
            document.querySelector("dialog:modal")
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
          }
          if (event.key === "Tab") {
            const controls = sidebar.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
            );
            const visible = Array.from(controls ?? []).filter(
              (el) => el.getClientRects().length > 0,
            );
            const first = visible[0];
            const last = visible.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <Brand dark />
        <button
          className="mobile-close icon-button"
          onClick={closeMenu}
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
          aria-current={view === "standards" ? "page" : undefined}
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
            onClick={(event) => {
              profileReturnFocus.current = isMobile
                ? menuButton.current
                : event.currentTarget;
              setMobileMenu(false);
              setProfileOpen(true);
            }}
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
      {isMobile && mobileMenu && (
        <button
          className="sidebar-overlay"
          aria-label="Close menu"
          onClick={closeMenu}
        />
      )}
      <div className="app-main" inert={isMobile && mobileMenu}>
        <header className="app-topbar">
          <Brand />
          <span className="masthead-context">
            {view === "standards"
              ? "Research standards"
              : NAV.find((n) => n.id === view)?.label}
          </span>
          <button
            ref={menuButton}
            className="mobile-menu"
            onClick={() => setMobileMenu(true)}
            aria-label="Open navigation"
            aria-expanded={mobileMenu}
            aria-controls="workspace-navigation"
          >
            <Menu size={21} aria-hidden="true" />
            Menu
          </button>
        </header>
        <main
          ref={main}
          id="main-content"
          className="dashboard-content"
          tabIndex={-1}
        >
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
          <Suspense fallback={null}>
            <DemoComparison
              showEntry={view === "overview"}
              openProvider={openProvider}
            />
          </Suspense>
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
              notify={notify}
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
      {notificationsEnabled && (
        <Suspense fallback={null}>
          <DashboardNotifications
            pending={pendingNotifications}
            onDelivered={delivered}
            comparisonActive={
              comparison.providers.length > 0 &&
              ["search", "shortlist"].includes(view)
            }
          />
        </Suspense>
      )}
      {selectedProvider && (
        <Suspense
          fallback={
            <Modal title={selectedProvider.name} close={closeProvider} wide>
              <p role="status">
                <Loader2 className="spin" aria-hidden="true" /> Loading provider
                details…
              </p>
            </Modal>
          }
        >
          <ProviderDetail
            key={selectedProvider.id}
            provider={selectedProvider}
            initialPane={initialPane}
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
            close={closeProvider}
          />
        </Suspense>
      )}
      {profileOpen && (
        <ProfileDialog
          profile={workspace.profile}
          close={closeProfile}
          save={(profile) => {
            if (update((w) => ({ ...w, profile }))) {
              if (profile.zip.trim() !== search.request.zip) comparison.clear();
              search.filter({ zip: profile.zip });
              closeProfile();
              notify("Your workspace has been updated.");
            }
          }}
        />
      )}
    </div>
  );
}
