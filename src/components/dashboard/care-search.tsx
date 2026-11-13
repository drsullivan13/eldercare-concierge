import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  Loader2,
  MapPin,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  type Provider,
  type SearchProvider,
} from "@/lib/providers";
import type { CareSearch } from "@/hooks/use-care-search";
import { ResultViewControl } from "./result-view-control";
import { ResearchDisclosure } from "./research-disclosure";
import { CareSearchFilters } from "./care-search-filters";
import "./care-search-filters.css";

const CareSearchDrawer = dynamic(() => import("./care-search-drawer"), {
  ssr: false,
  loading: () => (
    <p className="care-filter-loading" role="status">
      Opening filters…
    </p>
  ),
});

function subscribeMobile(listener: () => void) {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function mobileSnapshot() {
  return window.matchMedia("(max-width: 760px)").matches;
}

const CareMap = dynamic(() => import("../care-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Loader2 className="spin" /> Loading map…
    </div>
  ),
});

const careCategories = Object.entries({
  all: "All care options",
  ...CATEGORY_LABELS,
});

export function CareSearchView({
  search,
  submit,
  cards,
  openProvider,
}: {
  search: CareSearch;
  submit: () => void;
  cards: (providers: SearchProvider[]) => ReactNode;
  openProvider: (provider: Provider) => void;
}) {
  const [showMap, setShowMap] = useState(false);
  const [panel, setPanel] = useState<"closed" | "filters" | "experience">(
    "closed",
  );
  const { draft, request, data, loading, error, displayCount } = search;
  const mobile = useSyncExternalStore(
    subscribeMobile,
    mobileSnapshot,
    () => false,
  );
  const [drawerLoaded, setDrawerLoaded] = useState(false);
  const filterTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (panel === "filters" && !mobile) {
      document
        .querySelector<HTMLInputElement>("#search-filters input")
        ?.focus();
    }
  }, [panel, mobile]);

  function discardFilters() {
    search.discardDraft();
    setPanel("closed");
  }

  const filters = (
    <CareSearchFilters
      search={search}
      active={panel === "filters"}
      onApply={() => {
        submit();
        setPanel("closed");
        filterTrigger.current?.focus();
      }}
      onCancel={() => {
        discardFilters();
        filterTrigger.current?.focus();
      }}
    />
  );
  return (
    <div className="care-search-view">
      <div className="page-heading compact">
        <div>
          <h1>
            Find care <em>nearby.</em>
          </h1>
        </div>
      </div>
      <div className="search-summary">
        <div>
          <MapPin size={18} aria-hidden="true" />
          <span>
            <strong>
              {data ? `${data.origin.city}, ${data.origin.zip}` : request.zip}
            </strong>
            <small>
              {request.radius} miles ·{" "}
              {careCategories.find(([id]) => id === request.category)?.[1]}
            </small>
          </span>
        </div>
        <button
          ref={filterTrigger}
          className="button button-outline"
          aria-haspopup={mobile ? "dialog" : undefined}
          aria-expanded={panel === "filters"}
          aria-controls={panel === "filters" ? "search-filters" : undefined}
          onClick={() => {
            if (panel === "filters") {
              discardFilters();
            } else {
              setDrawerLoaded(true);
              setPanel("filters");
            }
          }}
        >
          <SlidersHorizontal size={16} /> Filters
        </button>
      </div>
      {panel === "experience" && (
        <section
          className="experience-category-prompt"
          aria-labelledby="experience-category-heading"
        >
          <h2 id="experience-category-heading">
            Choose a care type to rank by experience
          </h2>
          <p>
            Consumer reviews, not clinical quality or safety. Compare scores
            within one care type.
          </p>
          <label className="search-filter-field">
            Care type
            <select
              autoFocus
              aria-label="Care type for experience"
              defaultValue=""
              onChange={(event) => {
                search.filter({
                  category: event.target.value,
                  sort: "experience",
                });
                setPanel("closed");
              }}
            >
              <option value="" disabled>
                Choose care type
              </option>
              {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="text-link" onClick={() => setPanel("closed")}>
            Cancel
          </button>
        </section>
      )}
      {mobile ? (
        drawerLoaded && (
          <CareSearchDrawer
            open={panel === "filters"}
            onDismiss={discardFilters}
            trigger={filterTrigger}
          >
            {filters}
          </CareSearchDrawer>
        )
      ) : (
        <div
          hidden={panel !== "filters"}
          onKeyDown={(event) => {
            const suggestionsOpen =
              event.target instanceof HTMLElement &&
              event.target.closest('[role="combobox"][aria-expanded="true"]');
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              !suggestionsOpen
            ) {
              discardFilters();
              filterTrigger.current?.focus();
            }
          }}
        >
          {filters}
        </div>
      )}
      <label className="search-sort">
        Sort
        <select
          aria-label="Sort results"
          value={request.sort}
          onChange={(event) => {
            if (
              event.target.value === "experience" &&
              request.category === "all"
            ) {
              setPanel("experience");
            } else {
              search.filter({ sort: event.target.value });
              if (
                (event.target.value === "experience" &&
                  draft.category === "all") ||
                (event.target.value === "cms-rating" &&
                  draft.category !== "nursing-home")
              ) {
                search.edit("sort", "distance");
              }
              setPanel("closed");
            }
          }}
        >
          <option value="distance">Nearest first</option>
          <option value="experience">Highest experience</option>
          {request.category === "nursing-home" && (
            <option value="cms-rating">Highest CMS rating</option>
          )}
        </select>
      </label>
      <div className="results-toolbar">
        <div aria-live="polite">
          <strong>
            {loading
              ? "Searching…"
              : data
                ? `${data.total} care ${data.total === 1 ? "option" : "options"}`
                : "No results to show"}
          </strong>
        </div>
        <div className="result-controls">
          <ResultViewControl showMap={showMap} onChange={setShowMap} />
        </div>
      </div>
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      {loading ? (
        <div className="result-skeleton" aria-label="Loading care options">
          {[1, 2, 3, 4, 5, 6].map((number) => (
            <div key={number}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : (
        data && (
          <>
            <details className="search-evidence">
              <summary>Sources & evidence</summary>
              <ResearchDisclosure
                data={data}
                filtered={
                  search.request.sort === "experience" ||
                  search.request.evidence !== "all"
                }
              />
            </details>
            {showMap && (
              <CareMap
                providers={data.providers}
                origin={data.origin}
                radius={data.radius}
                onOpen={openProvider}
              />
            )}
            {data.providers.length > 0 ? (
              <>
                <div className="provider-grid">
                  {cards(data.providers.slice(0, displayCount))}
                </div>
                {displayCount < data.providers.length && (
                  <div className="load-more">
                    <button
                      className="button button-outline"
                      onClick={search.showMore}
                    >
                      Show more options <ChevronDown size={16} />
                    </button>
                    <span>
                      Showing {Math.min(displayCount, data.providers.length)} of{" "}
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
                  provider name. Our pilot catalog does not include every local
                  service.
                </p>
                <button
                  className="button button-outline"
                  onClick={search.widen}
                >
                  Widen this search
                </button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
