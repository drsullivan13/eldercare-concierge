import { ArrowRight, MapPin } from "lucide-react";
import type { CareSearch } from "@/hooks/use-care-search";
import { CATEGORY_LABELS } from "@/lib/providers";

import { ProviderTownAutocomplete } from "./provider-town-autocomplete";

export function CareSearchFilters({
  search,
  active,
  onApply,
  onCancel,
}: {
  search: CareSearch;
  active: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { draft } = search;
  return (
    <form
      id="search-filters"
      aria-label="Care search filters"
      className="research-search care-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="care-filter-fields">
        <label>
          <span>ZIP code</span>
          <div className="input-icon">
            <MapPin size={17} aria-hidden="true" />
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
        <div className="name-search">
          {active && (
            <ProviderTownAutocomplete
              value={draft.q}
              onChange={(value) => search.edit("q", value)}
              zip={draft.zip}
              radius={String(draft.radius)}
              category={draft.category}
            />
          )}
        </div>
        <label>
          <span>Care type</span>
          <select
            aria-label="Care category"
            value={draft.category}
            onChange={(event) => search.edit("category", event.target.value)}
          >
            {Object.entries({
              all: "All care options",
              ...CATEGORY_LABELS,
            }).map(([id, label]) => (
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
      </div>
      <div className="care-filter-actions">
        <button
          type="button"
          className="button button-outline"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className="button button-primary">
          Apply filters <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
