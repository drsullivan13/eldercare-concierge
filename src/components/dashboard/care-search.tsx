import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  ChevronDown,
  List,
  Loader2,
  Map as MapIcon,
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
import { ResearchDisclosure } from "./research-disclosure";

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
          className="button button-outline"
          aria-expanded={panel === "filters"}
          aria-controls="search-filters"
          onClick={() => setPanel(panel === "filters" ? "closed" : "filters")}
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
      <form
        id="search-filters"
        hidden={panel !== "filters"}
        className="research-search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
          setPanel("closed");
        }}
      >
        <label>
          <span>ZIP code</span>
          <div className="input-icon">
            <MapPin size={17} />
            <input
              value={draft.zip}
              onChange={(event) => search.edit("zip", event.target.value)}
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
            value={draft.radius}
            onChange={(event) => search.edit("radius", event.target.value)}
            aria-label="Search radius"
          >
            {[5, 10, 15, 25, 50].map((radius) => (
              <option key={radius} value={radius}>
                {radius} miles
              </option>
            ))}
          </select>
        </label>
        <label className="name-search">
          <span>Provider or town</span>
          <div className="input-icon">
            <Search size={17} />
            <input
              value={draft.q}
              onChange={(event) => search.edit("q", event.target.value)}
              placeholder="Search by name or town"
              maxLength={100}
            />
          </div>
        </label>
        <label>
          <span>Care type</span>
          <select
            aria-label="Care category"
            value={draft.category}
            onChange={(event) => search.edit("category", event.target.value)}
          >
            {careCategories.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Evidence</span>
          <select
            aria-label="Research filter"
            value={draft.evidence}
            onChange={(event) => search.edit("evidence", event.target.value)}
          >
            <option value="all">All options</option>
            <option value="details">Offerings researched</option>
            <option value="pricing">Published costs</option>
            <option value="openings">Published opening claims</option>
            <option value="reviews">Has experience score</option>
            <option value="facebook">Facebook findings</option>
            <option value="unrated">Needs experience score</option>
          </select>
        </label>
        <button type="submit" className="button button-primary">
          Apply filters <ArrowRight size={16} />
        </button>
      </form>
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
