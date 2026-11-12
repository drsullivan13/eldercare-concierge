"use client";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  ExternalLink,
  FileCheck2,
  Home,
  Info,
  LayoutDashboard,
  List,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { ProviderCard } from "./provider-card";
import { ProviderDetail } from "./provider-detail";
import { Modal } from "./modal";
import {
  CATEGORY_LABELS,
  type Provider,
  type SearchProvider,
  type SearchResponse,
} from "@/lib/providers";
import { distanceMiles } from "@/lib/distance";
import { useWorkspace } from "@/hooks/use-workspace";
import { createClient } from "@/lib/supabase/client";
import type { Workspace } from "@/lib/workspace";
const CareMap = dynamic(() => import("./care-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Loader2 className="spin" /> Loading map…
    </div>
  ),
});
type View = "overview" | "search" | "shortlist" | "plan" | "standards";
const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "search", label: "Find care", icon: Search },
  { id: "shortlist", label: "Your shortlist", icon: Bookmark },
  { id: "plan", label: "Your plan", icon: ClipboardList },
] as const;
const TASK_CATEGORIES = [
  "Research",
  "Care",
  "Visits",
  "Equipment",
  "Travel",
  "Finances",
  "Moving",
  "Family",
];
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
  const [zip, setZip] = useState(workspace.profile.zip || "02459");
  const [radius, setRadius] = useState("25");
  const [category, setCategory] = useState(
    workspace.profile.careTypes.length === 1
      ? workspace.profile.careTypes[0]
      : "all",
  );
  const [sort, setSort] = useState("distance");
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState("all");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [request, setRequest] = useState({
    evidence: "all",
    zip: workspace.profile.zip || "02459",
    radius: "25",
    category:
      workspace.profile.careTypes.length === 1
        ? workspace.profile.careTypes[0]
        : "all",
    sort: "distance",
    q: "",
  });
  const [showMap, setShowMap] = useState(false);
  const [displayCount, setDisplayCount] = useState(18);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [savedRecords, setSavedRecords] = useState<Provider[]>([]);
  const savedProviders = savedRecords.filter((p) =>
    workspace.savedProviderIds.includes(p.id),
  );
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareRecords, setCompareRecords] = useState<Provider[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(
    !demo && !workspace.profile.zip,
  );
  const [taskOpen, setTaskOpen] = useState(false);
  const [toast, setToast] = useState("");
  const savedIds = workspace.savedProviderIds.join(",");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/search?${new URLSearchParams(request)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Search is unavailable right now.");
        return result;
      })
      .then((result) => setData(result))
      .catch((e) => {
        if (e.name !== "AbortError") {
          setSearchError(e.message);
          setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request]);
  useEffect(() => {
    if (!savedIds) return;
    const controller = new AbortController();
    void fetch(`/api/providers?${new URLSearchParams({ ids: savedIds })}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok)
          throw new Error("Your saved providers could not be loaded.");
        return res.json();
      })
      .then((result) => setSavedRecords(result.providers))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [savedIds, setError]);
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
  const completed = workspace.tasks.filter(
    (task) => task.status === "done",
  ).length;
  const pending = workspace.tasks.filter((task) => task.status === "todo");
  function requestSearch(next: typeof request) {
    setLoading(true);
    setSearchError("");
    setDisplayCount(18);
    setRequest(next);
  }
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
  function submitSearch(e?: FormEvent) {
    e?.preventDefault();
    setCompareIds([]);
    requestSearch({
      zip: zip.trim(),
      radius,
      category,
      sort,
      q: query.trim(),
      evidence,
    });
    navigate("search");
  }
  function changeCategory(value: string) {
    setCategory(value);
    const nextSort = value === "nursing-home" ? sort : "distance";
    setSort(nextSort);
    setCompareIds([]);
    requestSearch({ ...request, category: value, sort: nextSort });
  }
  function toggleCompare(id: string) {
    const candidate = [...(data?.providers ?? []), ...savedProviders].find(
      (p) => p.id === id,
    );
    if (candidate)
      setCompareRecords((records) => [
        ...records.filter((p) => p.id !== id),
        candidate,
      ]);
    setCompareIds((ids) =>
      ids.includes(id)
        ? ids.filter((value) => value !== id)
        : ids.length < 3
          ? [...ids, id]
          : (setToast("Compare up to three options at a time."), ids),
    );
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
    const lines = [
      "# Harbor care research plan",
      `Exported ${new Date().toLocaleDateString("en-US")}`,
      "",
      `Search area: ${workspace.profile.zip || request.zip}`,
      "",
      "## Shortlist",
      ...savedProviders.flatMap((p) => [
        `### ${p.name}`,
        `${CATEGORY_LABELS[p.category]} · ${p.address}, ${p.city} ${p.zip}`,
        ...p.sources.map(
          (s) => `- ${s.title}: ${s.url} (retrieved ${s.checkedAt})`,
        ),
        workspace.notes[p.id] ? `Notes: ${workspace.notes[p.id]}` : "",
        "",
      ]),
      "## Next steps",
      ...workspace.tasks.map(
        (t) =>
          `- [${t.status === "done" ? "x" : " "}] ${t.title}${t.dueDate ? ` · Due ${t.dueDate}` : ""} · ${t.category}`,
      ),
      "",
      "Provider availability, costs and personal fit require confirmation.",
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
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
      const { error } = await createClient().auth.signOut();
      if (error) {
        setError("Could not sign out. Please try again.");
        return;
      }
    }
    router.push("/");
    router.refresh();
  }
  const cards = (providers: SearchProvider[], compare = true) =>
    providers.map((provider) => (
      <ProviderCard
        key={provider.id}
        provider={provider}
        saved={savedSet.has(provider.id)}
        onSave={() => saveProvider(provider)}
        onOpen={() => setSelected(provider)}
        compare={compareIds.includes(provider.id)}
        onCompare={compare ? () => toggleCompare(provider.id) : undefined}
      />
    ));
  const compareProviders = Array.from(
    new Map(
      [...compareRecords, ...(data?.providers || []), ...savedProviders].map(
        (p) => [p.id, p],
      ),
    ).values(),
  ).filter((p) => compareIds.includes(p.id));

  return (
    <div className="app-shell">
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
        <div className="sidebar-note">
          <div className="sidebar-note-mark">
            <ShieldCheck size={24} />
          </div>
          <h3>
            Confidence comes <br />
            from the details.
          </h3>
          <p>
            See the sources behind each option, and what still needs checking.
          </p>
          <button onClick={() => navigate("standards")}>
            Our research standards <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span>
            <span className="live-dot" /> GREATER BOSTON PILOT
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
          <div>
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileMenu(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              Your workspace <span>/</span>{" "}
              <strong>
                {view === "standards"
                  ? "Research standards"
                  : NAV.find((n) => n.id === view)?.label}
              </strong>
            </span>
          </div>
          <div className="topbar-actions">
            <span className="save-status">
              <span className="live-dot" />
              {saveStatus}
            </span>
            <button
              className="icon-button"
              onClick={signOut}
              disabled={saveStatus === "Saving…"}
              aria-label={demo ? "Leave demo" : "Sign out"}
              title={demo ? "Leave demo" : "Sign out"}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <Info size={14} />
            <span>
              Demo workspace · Real provider records. Your plan stays in this
              browser.
            </span>
            {ACCOUNTS_ENABLED && (
              <Link href="/signup">
                Create an account <ArrowUpRight size={13} />
              </Link>
            )}
          </div>
        )}
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
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {workspace.profile.name
                      ? `WELCOME, ${workspace.profile.name.toUpperCase()}`
                      : "YOUR NEXT CHAPTER STARTS HERE"}
                  </span>
                  <h1>
                    A clearer plan. <br />
                    <em>One step at a time.</em>
                  </h1>
                  <p>
                    You’re bringing the pieces together. Let’s find the right
                    next step.
                  </p>
                </div>
                <button
                  className="button button-outline export-button"
                  onClick={exportPlan}
                >
                  <Download size={16} /> Export plan
                </button>
              </div>
              <div className="overview-grid">
                <section className="search-hero">
                  <div className="search-hero-text">
                    <span className="eyebrow">START WITH WHAT’S NEARBY</span>
                    <h2>Find care worth a closer look.</h2>
                    <p>
                      Explore care settings and help at home, with the evidence
                      in view.
                    </p>
                  </div>
                  <form className="quick-search" onSubmit={submitSearch}>
                    <label>
                      <span>ZIP code</span>
                      <div>
                        <MapPin size={17} />
                        <input
                          name="zip"
                          aria-label="Search ZIP code"
                          value={zip}
                          onChange={(e) => setZip(e.target.value)}
                          inputMode="numeric"
                          pattern="[0-9]{5}"
                          maxLength={5}
                          required
                        />
                      </div>
                    </label>
                    <label>
                      <span>Search radius</span>
                      <select
                        aria-label="Search radius"
                        value={radius}
                        onChange={(e) => setRadius(e.target.value)}
                      >
                        {[5, 10, 15, 25, 50].map((r) => (
                          <option key={r} value={r}>
                            {r} miles
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="button button-primary" type="submit">
                      Find care <ArrowRight size={18} />
                    </button>
                  </form>
                  <div className="search-hero-foot">
                    <ShieldCheck size={14} /> Official records, provider
                    information and clear next questions.
                  </div>
                </section>
                <section className="plan-snapshot">
                  <span className="eyebrow">YOUR PLAN, AT A GLANCE</span>
                  <div className="snapshot-row">
                    <span className="snapshot-icon">
                      <Bookmark size={18} />
                    </span>
                    <div>
                      <strong>{workspace.savedProviderIds.length}</strong>
                      <span>options on your shortlist</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Open shortlist"
                      onClick={() => navigate("shortlist")}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-icon">
                      <ClipboardList size={18} />
                    </span>
                    <div>
                      <strong>{pending.length}</strong>
                      <span>next steps to work through</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Open your plan"
                      onClick={() => navigate("plan")}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div className="snapshot-progress">
                    <span>
                      {completed} of {workspace.tasks.length} tasks complete
                    </span>
                    <div>
                      <i
                        style={{
                          width: `${workspace.tasks.length ? (completed / workspace.tasks.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </section>
              </div>
              <section className="journey-section">
                <div className="section-title">
                  <div>
                    <span className="eyebrow">THE BIGGER PICTURE</span>
                    <h2>A 90-day transition, made manageable.</h2>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => navigate("plan")}
                  >
                    View your plan <ArrowRight size={16} />
                  </button>
                </div>
                <div className="journey-grid">
                  {[
                    {
                      number: "01",
                      title: "Get oriented",
                      days: "DAYS 1–7",
                      text: "Understand needs. Research options. Build a shortlist.",
                      icon: Search,
                    },
                    {
                      number: "02",
                      title: "Put care in place",
                      days: "DAYS 8–30",
                      text: "Arrange care, visits, equipment and the practical details.",
                      icon: Home,
                    },
                    {
                      number: "03",
                      title: "Help things settle",
                      days: "DAYS 31–90",
                      text: "Check what’s working. Follow up. Adjust the plan.",
                      icon: CheckCircle2,
                    },
                  ].map((phase, index) => (
                    <article
                      key={phase.number}
                      className={index === 0 ? "current-phase" : ""}
                    >
                      <div className="journey-top">
                        <span className="phase-number">{phase.number}</span>
                        <span>{phase.days}</span>
                        <phase.icon size={20} />
                      </div>
                      <h3>{phase.title}</h3>
                      <p>{phase.text}</p>
                      {index === 0 && (
                        <span className="phase-badge">
                          Suggested starting point
                        </span>
                      )}
                    </article>
                  ))}
                </div>
              </section>
              <div className="overview-lower">
                <section className="next-steps-panel">
                  <div className="section-title">
                    <h2>A few useful next steps</h2>
                    <button
                      className="text-link"
                      onClick={() => setTaskOpen(true)}
                    >
                      <Plus size={15} /> Add
                    </button>
                  </div>
                  {pending.slice(0, 3).map((task) => (
                    <div className="task-row" key={task.id}>
                      <button
                        className="task-checkbox"
                        aria-label={`Complete ${task.title}`}
                        onClick={() =>
                          update((w) => ({
                            ...w,
                            tasks: w.tasks.map((t) =>
                              t.id === task.id ? { ...t, status: "done" } : t,
                            ),
                          }))
                        }
                      />
                      <div>
                        <strong>{task.title}</strong>
                        <span>{task.category}</span>
                      </div>
                      <ArrowUpRight size={16} className="muted" />
                    </div>
                  ))}
                  {pending.length === 0 && (
                    <div className="quiet-empty">
                      <CheckCircle2 />
                      <p>
                        You’re up to date. Add a next step when you’re ready.
                      </p>
                    </div>
                  )}
                  <button
                    className="text-link panel-footer-link"
                    onClick={() => navigate("plan")}
                  >
                    See all next steps <ArrowRight size={15} />
                  </button>
                </section>
                <section className="evidence-note">
                  <span className="evidence-note-icon">
                    <FileCheck2 size={23} />
                  </span>
                  <span className="eyebrow">BEHIND EVERY OPTION</span>
                  <h2>
                    More than <br />a good review.
                  </h2>
                  <p>
                    Inspections. Staffing. Certification. We show what the
                    public record says—and where it leaves questions.
                  </p>
                  <button
                    className="text-link"
                    onClick={() => navigate("standards")}
                  >
                    How we research care <ArrowUpRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "search" && (
            <>
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">CARE RESOURCE RESEARCH</span>
                  <h1>
                    Find your next <em>possibility.</em>
                  </h1>
                  <p>
                    Start nearby. Look closely. Keep the options that deserve a
                    conversation.
                  </p>
                </div>
                <span className="region-badge">
                  <MapPin size={15} /> Greater Boston
                </span>
              </div>
              <form className="research-search" onSubmit={submitSearch}>
                <label>
                  <span>ZIP code</span>
                  <div className="input-icon">
                    <MapPin size={17} />
                    <input
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      aria-label="Search ZIP code"
                      inputMode="numeric"
                      pattern="[0-9]{5}"
                      maxLength={5}
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>Within</span>
                  <select
                    value={radius}
                    onChange={(e) => setRadius(e.target.value)}
                    aria-label="Search radius"
                  >
                    {[5, 10, 15, 25, 50].map((r) => (
                      <option key={r} value={r}>
                        {r} miles
                      </option>
                    ))}
                  </select>
                </label>
                <label className="name-search">
                  <span>Provider or town</span>
                  <div className="input-icon">
                    <Search size={17} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by name or town"
                      maxLength={100}
                    />
                  </div>
                </label>
                <button type="submit" className="button button-primary">
                  Search <ArrowRight size={16} />
                </button>
              </form>
              <div className="category-tabs" aria-label="Care category">
                <button
                  className={category === "all" ? "active" : ""}
                  aria-pressed={category === "all"}
                  onClick={() => changeCategory("all")}
                >
                  All care options
                </button>
                {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
                  <button
                    key={id}
                    className={category === id ? "active" : ""}
                    aria-pressed={category === id}
                    onClick={() => changeCategory(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="evidence-strip">
                <ShieldCheck size={20} />
                <div>
                  <strong>Evidence first. No paid placement.</strong>
                  <span>
                    Official records and provider claims are labeled separately.
                    Current availability and fit need confirmation.
                  </span>
                </div>
                <button
                  onClick={() => navigate("standards")}
                  className="text-link"
                >
                  Our standards <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="results-toolbar">
                <div>
                  <strong>
                    {loading
                      ? "Searching…"
                      : data
                        ? `${data.total} care options`
                        : "No results to show"}
                  </strong>
                  {data && !loading && (
                    <span>
                      within {data.radius} miles of {data.origin.city}{" "}
                      {data.origin.zip}
                    </span>
                  )}
                </div>
                <div className="result-controls">
                  <label className="sort-label">
                    Research
                    <select
                      aria-label="Research filter"
                      value={evidence}
                      onChange={(e) => {
                        setEvidence(e.target.value);
                        requestSearch({ ...request, evidence: e.target.value });
                      }}
                    >
                      <option value="all">All options</option>
                      <option value="details">Offerings researched</option>
                      <option value="pricing">Published costs</option>
                      <option value="openings">Published opening claims</option>
                      <option value="reviews">Has experience score</option>
                    </select>
                  </label>
                  <label className="sort-label">
                    Sort by
                    <select
                      aria-label="Sort results"
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value);
                        requestSearch({ ...request, sort: e.target.value });
                      }}
                    >
                      <option value="distance">Distance</option>
                      {category !== "all" && (
                        <option value="experience">
                          Consumer experience index
                        </option>
                      )}
                      {category === "nursing-home" && (
                        <option value="cms-rating">CMS overall rating</option>
                      )}
                    </select>
                  </label>
                  <div className="view-toggle">
                    <button
                      className={!showMap ? "active" : ""}
                      aria-label="List view"
                      aria-pressed={!showMap}
                      onClick={() => setShowMap(false)}
                    >
                      <List size={18} />
                    </button>
                    <button
                      className={showMap ? "active" : ""}
                      aria-label="Map view"
                      aria-pressed={showMap}
                      onClick={() => setShowMap(true)}
                    >
                      <MapIcon size={18} />
                    </button>
                  </div>
                </div>
              </div>
              {searchError && (
                <div role="alert" className="form-error">
                  {searchError}
                </div>
              )}
              {!loading && (sort === "experience" || evidence !== "all") && (
                <p className="research-filter-note">
                  Research coverage is still growing. Unresearched options may
                  have the same offerings. Consumer scores summarize public
                  ratings; published opening claims need direct confirmation.
                </p>
              )}
              {loading ? (
                <div className="result-skeleton">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div key={n}>
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              ) : (
                data && (
                  <>
                    {showMap && (
                      <CareMap
                        providers={data.providers}
                        origin={data.origin}
                        radius={data.radius}
                        onOpen={openProvider}
                      />
                    )}
                    <p className="results-note">
                      <Info size={13} /> Straight-line distance from an
                      approximate ZIP location.{" "}
                      {category === "home-care" ||
                      category === "home-health" ||
                      category === "staffing"
                        ? "An office in this radius does not establish service coverage."
                        : "The list is a research starting point, not a recommendation."}
                    </p>
                    {data.providers.length > 0 ? (
                      <>
                        <div className="provider-grid">
                          {cards(data.providers.slice(0, displayCount))}
                        </div>
                        {displayCount < data.providers.length && (
                          <div className="load-more">
                            <button
                              className="button button-outline"
                              onClick={() => setDisplayCount((c) => c + 18)}
                            >
                              Show more options <ChevronDown size={16} />
                            </button>
                            <span>
                              Showing{" "}
                              {Math.min(displayCount, data.providers.length)} of{" "}
                              {data.providers.length}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-state">
                        <Search size={35} />
                        <h2>No matching options in this search.</h2>
                        <p>
                          Try a wider radius, another care category or a shorter
                          provider name. Our pilot catalog does not include
                          every local service.
                        </p>
                        <button
                          className="button button-outline"
                          onClick={() => {
                            setCategory("all");
                            setQuery("");
                            setRadius("50");
                            requestSearch({
                              ...request,
                              category: "all",
                              q: "",
                              radius: "50",
                              sort: "distance",
                            });
                            setSort("distance");
                          }}
                        >
                          Widen this search
                        </button>
                      </div>
                    )}
                    <p className="catalog-note">
                      Catalog retrieved {data.asOf}. {data.catalogTotal} records
                      in this pilot.
                      {data.excludedWithoutCoordinates > 0
                        ? ` ${data.excludedWithoutCoordinates} records without usable location coordinates are excluded from radius results.`
                        : ""}{" "}
                      Facility coverage stops 55 miles from central Boston;
                      search circles can extend beyond it. Sources and
                      publication dates are inside each record.
                    </p>
                  </>
                )
              )}
            </>
          )}
          {view === "shortlist" && (
            <>
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">A THOUGHTFUL SHORTLIST</span>
                  <h1>
                    Keep the <em>possibilities.</em>
                  </h1>
                  <p>
                    Your saved options, source trails and questions—all in one
                    place.
                  </p>
                </div>
                <button className="button button-outline" onClick={exportPlan}>
                  <Download size={16} /> Export plan
                </button>
              </div>
              {savedProviders.length > 0 ? (
                <>
                  <div className="results-toolbar">
                    <div>
                      <strong>
                        {savedProviders.length} saved option
                        {savedProviders.length === 1 ? "" : "s"}
                      </strong>
                      <span>Select up to three to compare side by side.</span>
                    </div>
                    <button
                      className="button button-outline"
                      onClick={() => navigate("search")}
                    >
                      <Plus size={16} /> Find more care
                    </button>
                  </div>
                  <div className="provider-grid">
                    {cards(
                      savedProviders.map((p) => ({
                        ...p,
                        distanceMiles:
                          data?.origin && p.lat !== null && p.lng !== null
                            ? distanceMiles(data.origin, {
                                lat: p.lat,
                                lng: p.lng,
                              })
                            : null,
                      })),
                    )}
                  </div>
                </>
              ) : (
                <div className="empty-state shortlist-empty">
                  <span className="empty-icon">
                    <Bookmark size={32} />
                  </span>
                  <h2>A good shortlist starts with one option.</h2>
                  <p>
                    Save resources as you explore. Their sources and your
                    questions will stay together here.
                  </p>
                  <button
                    className="button button-primary"
                    onClick={() => navigate("search")}
                  >
                    Find care nearby <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </>
          )}
          {view === "plan" && (
            <>
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">YOUR 90-DAY TRANSITION PLAN</span>
                  <h1>
                    One less thing <em>to hold.</em>
                  </h1>
                  <p>
                    Make room for care, travel, equipment and everything in
                    between.
                  </p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => setTaskOpen(true)}
                >
                  <Plus size={17} /> Add a next step
                </button>
              </div>
              <div className="plan-summary">
                <div>
                  <CheckCircle2 size={24} />
                  <strong>
                    {completed}
                    <span>completed</span>
                  </strong>
                </div>
                <div>
                  <ClipboardList size={24} />
                  <strong>
                    {pending.length}
                    <span>still to do</span>
                  </strong>
                </div>
                <div>
                  <Bookmark size={24} />
                  <strong>
                    {savedProviders.length}
                    <span>care options saved</span>
                  </strong>
                </div>
                <button className="text-link" onClick={exportPlan}>
                  <Download size={16} /> Export your plan
                </button>
              </div>
              <div className="plan-table">
                <div className="plan-table-heading">
                  <span>NEXT STEP</span>
                  <span>CATEGORY</span>
                  <span>DUE DATE</span>
                  <span />
                </div>
                {workspace.tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`plan-task ${task.status === "done" ? "task-done" : ""}`}
                  >
                    <div>
                      <button
                        className={`task-checkbox ${task.status === "done" ? "checked" : ""}`}
                        aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                        onClick={() =>
                          update((w) => ({
                            ...w,
                            tasks: w.tasks.map((t) =>
                              t.id === task.id
                                ? {
                                    ...t,
                                    status:
                                      t.status === "done" ? "todo" : "done",
                                  }
                                : t,
                            ),
                          }))
                        }
                      >
                        {task.status === "done" && <Check size={13} />}
                      </button>
                      <span>{task.title}</span>
                    </div>
                    <span className="task-category">{task.category}</span>
                    <span className="task-date">
                      {task.dueDate
                        ? new Date(
                            `${task.dueDate}T12:00:00`,
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "No date set"}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${task.title}`}
                      onClick={() =>
                        update((w) => ({
                          ...w,
                          tasks: w.tasks.filter((t) => t.id !== task.id),
                        }))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {workspace.tasks.length === 0 && (
                  <div className="quiet-empty">
                    <ClipboardList />
                    <p>Add a next step to begin your plan.</p>
                  </div>
                )}
                <button
                  className="add-task-row"
                  onClick={() => setTaskOpen(true)}
                >
                  <Plus size={17} /> Add a next step
                </button>
              </div>
              <div className="plan-suggestions">
                <h2>Other pieces to plan for</h2>
                <p>
                  Use these prompts when they become relevant to your family.
                </p>
                <div>
                  {[
                    {
                      title: "Coordinate a visit or care assessment",
                      category: "Visits",
                    },
                    {
                      title: "Check equipment and delivery arrangements",
                      category: "Equipment",
                    },
                    {
                      title: "Plan travel and who can be there",
                      category: "Travel",
                    },
                    {
                      title: "Organize cost and benefits questions",
                      category: "Finances",
                    },
                    {
                      title: "Plan the move and the first week",
                      category: "Moving",
                    },
                    {
                      title: "Agree on a family update routine",
                      category: "Family",
                    },
                  ].map((item) => (
                    <button
                      key={item.title}
                      onClick={() =>
                        addTask(item.title, undefined, item.category)
                      }
                    >
                      <span>{item.title}</span>
                      <Plus size={17} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {view === "standards" && <EvidenceStandards />}
        </main>
        <footer className="app-footer">
          <span>
            harbor. <span>A clearer path to care.</span>
          </span>
          <button onClick={() => navigate("standards")}>
            Sources & research standards <ArrowUpRight size={12} />
          </button>
        </footer>
      </div>
      {compareIds.length > 0 && ["search", "shortlist"].includes(view) && (
        <div className="compare-bar">
          <span>
            <strong>{compareIds.length}</strong> of 3 options selected
          </span>
          <button className="text-link" onClick={() => setCompareIds([])}>
            Clear
          </button>
          <button
            className="button button-primary"
            disabled={compareIds.length < 2}
            onClick={() => setCompareOpen(true)}
          >
            Compare options <ArrowRight size={16} />
          </button>
        </div>
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
              setZip(profile.zip);
              requestSearch({ ...request, zip: profile.zip });
              setProfileOpen(false);
              setToast("Your workspace has been updated.");
            }
          }}
        />
      )}
      {taskOpen && (
        <TaskDialog
          close={() => setTaskOpen(false)}
          save={(title, category, dueDate) => {
            addTask(title, undefined, category, dueDate);
            setTaskOpen(false);
          }}
        />
      )}
      {compareOpen && (
        <CompareDialog
          providers={compareProviders}
          close={() => setCompareOpen(false)}
          open={(p) => {
            setCompareOpen(false);
            setSelected(p);
          }}
        />
      )}
    </div>
  );
}
function ProfileDialog({
  profile,
  save,
  close,
}: {
  profile: Workspace["profile"];
  save: (profile: Workspace["profile"]) => void;
  close: () => void;
}) {
  const [value, setValue] = useState(profile);
  return (
    <Modal title="Your care workspace" close={close}>
      <span className="eyebrow">A LITTLE CONTEXT</span>
      <h2>Make this your workspace.</h2>
      <p className="muted">
        Start with the basics. You can change these any time.
      </p>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(value);
        }}
      >
        <label>
          Your first name
          <input
            value={value.name}
            maxLength={80}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            placeholder="First name"
            autoComplete="given-name"
          />
        </label>
        <label>
          Who are you researching care for?
          <select
            value={value.relationship}
            onChange={(e) =>
              setValue({ ...value, relationship: e.target.value })
            }
          >
            {[
              "A parent",
              "Myself",
              "A partner",
              "Another family member",
              "Someone I support",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          ZIP code to search near
          <input
            value={value.zip}
            onChange={(e) => setValue({ ...value, zip: e.target.value })}
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            required
            placeholder="02459"
          />
        </label>
        <fieldset>
          <legend>What would you like to explore?</legend>
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
            <label className="checkbox-label" key={id}>
              <input
                type="checkbox"
                checked={value.careTypes.includes(id)}
                onChange={() =>
                  setValue({
                    ...value,
                    careTypes: value.careTypes.includes(id)
                      ? value.careTypes.filter((c) => c !== id)
                      : [...value.careTypes, id],
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="privacy-note">
          Just research preferences here. Please leave out medical, financial
          and other sensitive information.
        </p>
        <button className="button button-primary full-width">
          Save & continue <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
function TaskDialog({
  save,
  close,
}: {
  save: (title: string, category: string, dueDate: string) => void;
  close: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Research");
  const [dueDate, setDueDate] = useState("");
  return (
    <Modal title="Add a next step" close={close}>
      <span className="eyebrow">KEEP IT MOVING</span>
      <h2>What’s the next step?</h2>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save(title.trim(), category, dueDate);
        }}
      >
        <label>
          Task
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="For example, schedule a visit"
            maxLength={200}
            required
            autoFocus
          />
        </label>
        <div className="form-two-cols">
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Due date <span className="muted">(optional)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        <button className="button button-primary full-width">
          Add to my plan <Plus size={16} />
        </button>
      </form>
    </Modal>
  );
}
function CompareDialog({
  providers,
  close,
  open,
}: {
  providers: Provider[];
  close: () => void;
  open: (p: Provider) => void;
}) {
  const mixed = new Set(providers.map((p) => p.category)).size > 1;
  return (
    <Modal title="Compare care options" close={close} wide>
      <span className="eyebrow">YOUR OPTIONS, SIDE BY SIDE</span>
      <h2>Look at the details together.</h2>
      {mixed && (
        <div className="inline-notice">
          These are different types of care. A CMS nursing-home rating cannot be
          used to judge an assisted-living residence or home-care agency.
        </div>
      )}
      <div className="comparison-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>What to look at</th>
              {providers.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                label: "Care setting",
                value: (p: Provider) => CATEGORY_LABELS[p.category],
              },
              {
                label: "Location",
                value: (p: Provider) =>
                  `${p.city}, ${p.zip}${p.locationKind === "office" ? " (office)" : ""}`,
              },
              {
                label: "CMS overall",
                value: (p: Provider) =>
                  p.cms
                    ? p.cms.overall === null
                      ? "Not published"
                      : `${p.cms.overall} / 5`
                    : "Not applicable",
              },
              {
                label: "CMS health inspections",
                value: (p: Provider) =>
                  p.cms
                    ? p.cms.inspections === null
                      ? "Not published"
                      : `${p.cms.inspections} / 5`
                    : "Not applicable",
              },
              {
                label: "CMS staffing",
                value: (p: Provider) =>
                  p.cms
                    ? p.cms.staffing === null
                      ? "Not published"
                      : `${p.cms.staffing} / 5`
                    : "Not applicable",
              },
              {
                label: "Public record",
                value: (p: Provider) =>
                  p.officialRecord
                    ? "Official record linked"
                    : "Provider information only",
              },
              {
                label: "Flags to review",
                value: (p: Provider) =>
                  p.warnings.join(" ") ||
                  "No flags surfaced in this snapshot. This is not clearance.",
              },
              { label: "Current availability", value: () => "Not confirmed" },
              {
                label: "Availability evidence",
                value: (p: Provider) =>
                  p.research?.availabilityStatus === "opening-published"
                    ? "Provider publishes an opening claim; confirm room and date"
                    : p.research?.availabilityStatus === "waitlist-published"
                      ? "Published waitlist; confirm timing"
                      : "Inquiry needed",
              },
              {
                label: "Published cost details",
                value: (p: Provider) =>
                  p.research?.publishedCosts
                    ? `${p.research.publishedCosts} sourced fee entries; open room & cost details`
                    : "Not established in this research",
              },
              {
                label: "Consumer experience index",
                value: (p: Provider) =>
                  p.research?.experience.value != null
                    ? `${p.research.experience.value.toFixed(1)} / 10 · ${p.research.experience.confidence} evidence`
                    : "Not rated",
              },
            ].map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {providers.map((p) => (
                  <td key={p.id}>{row.value(p)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th>Source details</th>
              {providers.map((p) => (
                <td key={p.id}>
                  <button className="text-link" onClick={() => open(p)}>
                    View evidence <ArrowUpRight size={14} />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
function EvidenceStandards() {
  return (
    <>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">HOW WE RESEARCH CARE</span>
          <h1>
            Look beyond <em>the stars.</em>
          </h1>
          <p>
            Useful evidence, honest limits and better questions for the next
            conversation.
          </p>
        </div>
        <ShieldCheck size={40} className="standards-emblem" />
      </div>
      <div className="standards-intro">
        <h2>
          A record is a starting point. <br />A source is something you can
          check.
        </h2>
        <p>
          Harbor does not label a provider “the best” because it has a good
          review average. We bring together public records and provider
          information, identify which claims each source supports, and show the
          questions that remain.
        </p>
      </div>
      <div className="standards-grid">
        {[
          {
            n: "01",
            title: "Regulatory records",
            text: "CMS nursing-home records and Massachusetts assisted-living listings establish distinct types of public evidence. A listing alone does not prove high-quality care.",
            tag: "Available now",
          },
          {
            n: "02",
            title: "Inspections & staffing",
            text: "For nursing homes, published inspections, staffing, turnover and penalties provide context that a review average misses. Reporting dates and limitations stay visible.",
            tag: "Available for nursing homes",
          },
          {
            n: "03",
            title: "Care fit & service coverage",
            text: "Provider websites describe services and areas served. These are provider claims. Confirm the specific needs, address, schedule and availability directly.",
            tag: "Provider information, labeled",
          },
          {
            n: "04",
            title: "Experience, with context",
            text: "Public review averages and selected accounts show different perspectives. The provisional 10-point index groups syndicated sources and leaves thin or ambiguous evidence unrated. CMS patient surveys stay separate.",
            tag: "Sources, dates and exclusions visible",
          },
        ].map((item) => (
          <article key={item.n}>
            <span>{item.n}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <small>{item.tag}</small>
          </article>
        ))}
      </div>
      <section className="standards-bottom">
        <Info size={22} />
        <div>
          <h3>How ordering works today</h3>
          <p>
            Results start with distance. Nursing-home searches can also use the
            published CMS overall rating, with distance breaking ties and
            missing ratings last. Within a care category, you can also sort the
            consumer experience index. It summarizes eligible public ratings,
            not clinical quality or safety. Missing evidence is not a poor
            rating, and no provider pays for placement.
          </p>
          <Link className="text-link" href="/methodology" target="_blank">
            Read the full methodology & source library{" "}
            <ExternalLink size={15} />
          </Link>
        </div>
      </section>
    </>
  );
}
