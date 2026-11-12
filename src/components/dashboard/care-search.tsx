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

export function CareSearchView({
  search,
  submit,
  changeCategory,
  cards,
  openProvider,
}: {
  search: CareSearch;
  submit: () => void;
  changeCategory: (category: string) => void;
  cards: (providers: SearchProvider[]) => ReactNode;
  openProvider: (provider: Provider) => void;
}) {
  const [showMap, setShowMap] = useState(false);
  const { draft, data, loading, error, displayCount } = search;
  return (
    <div className="care-search-view">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">GREATER BOSTON CARE</span>
          <h1>
            Find care <em>nearby.</em>
          </h1>
          <p>
            Explore your options and save the ones you want to know more about.
          </p>
        </div>
      </div>
      <form
        className="research-search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
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
        <button type="submit" className="button button-primary">
          Search <ArrowRight size={16} />
        </button>
      </form>
      <div className="category-tabs" aria-label="Care category">
        <button
          className={draft.category === "all" ? "active" : ""}
          aria-pressed={draft.category === "all"}
          onClick={() => changeCategory("all")}
        >
          All care options
        </button>
        {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
          <button
            key={id}
            className={draft.category === id ? "active" : ""}
            aria-pressed={draft.category === id}
            onClick={() => changeCategory(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="results-toolbar">
        <div aria-live="polite">
          <strong>
            {loading
              ? "Searching…"
              : data
                ? `${data.total} care ${data.total === 1 ? "option" : "options"}`
                : "No results to show"}
          </strong>
          {data && !loading && (
            <span>
              within {data.radius} miles of {data.origin.city} {data.origin.zip}
            </span>
          )}
        </div>
        <div className="result-controls">
          <label className="sort-label">
            Research
            <select
              aria-label="Research filter"
              value={draft.evidence}
              onChange={(event) =>
                search.filter({ evidence: event.target.value })
              }
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
          <label className="sort-label">
            Sort by
            <select
              aria-label="Sort results"
              value={draft.sort}
              onChange={(event) => search.filter({ sort: event.target.value })}
            >
              <option value="distance">Distance</option>
              {draft.category !== "all" && (
                <option value="experience">Consumer experience index</option>
              )}
              {draft.category === "nursing-home" && (
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
            <ResearchDisclosure
              data={data}
              category={search.request.category}
              filtered={
                search.request.sort === "experience" ||
                search.request.evidence !== "all"
              }
            />
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
