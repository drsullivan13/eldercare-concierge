import { ArrowRight, Bookmark, ClipboardList, MapPin } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/providers";
import type { Workspace } from "@/lib/workspace";
import type { CareSearch } from "@/hooks/use-care-search";

export function Overview({
  workspace,
  search,
  findCare,
  navigate,
}: {
  workspace: Workspace;
  search: CareSearch;
  findCare: () => void;
  navigate: (view: "shortlist" | "plan") => void;
}) {
  const pending = workspace.tasks.filter(
    (task) => task.status === "todo",
  ).length;
  return (
    <div className="care-overview">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">
            {workspace.profile.name
              ? `WELCOME, ${workspace.profile.name.toUpperCase()}`
              : "HERE FOR YOUR FAMILY"}
          </span>
          <h1>
            A clearer plan, <em>starting with care.</em>
          </h1>
          <p>
            Find nearby care, compare the details, and keep your next steps
            together.
          </p>
        </div>
      </div>
      <section
        className="search-hero care-search-home"
        aria-labelledby="care-search-heading"
      >
        <span className="eyebrow">
          {search.data?.market.label || "SEARCH BY ZIP"}
        </span>
        <h2 id="care-search-heading">What care are you looking for?</h2>
        <form
          className="quick-search"
          onSubmit={(event) => {
            event.preventDefault();
            findCare();
          }}
        >
          <label className="quick-care-type">
            <span>Care type</span>
            <select
              aria-label="Care type"
              value={search.draft.category}
              onChange={(event) => search.edit("category", event.target.value)}
            >
              <option value="all">Explore all care options</option>
              {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>ZIP code</span>
            <div>
              <MapPin size={17} />
              <input
                name="zip"
                aria-label="Search ZIP code"
                value={search.draft.zip}
                onChange={(event) => search.edit("zip", event.target.value)}
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
              value={search.draft.radius}
              onChange={(event) => search.edit("radius", event.target.value)}
            >
              {[5, 10, 15, 25, 50].map((radius) => (
                <option key={radius} value={radius}>
                  {radius} miles
                </option>
              ))}
            </select>
          </label>
          <button className="button button-primary" type="submit">
            Find care <ArrowRight size={18} />
          </button>
        </form>
        <p className="search-home-note">
          Real provider records. No paid placement. Save the options you want to
          explore.
        </p>
      </section>
      <div className="care-workspace-links">
        <button
          onClick={() => navigate("shortlist")}
          aria-label="Open shortlist"
        >
          <Bookmark size={22} />
          <span>
            <strong>Your shortlist</strong>
            <span>
              {workspace.savedProviderIds.length
                ? `${workspace.savedProviderIds.length} saved options to compare`
                : "Keep promising options in one place"}
            </span>
          </span>
          <ArrowRight size={18} />
        </button>
        <button onClick={() => navigate("plan")} aria-label="Open your plan">
          <ClipboardList size={22} />
          <span>
            <strong>Your next steps</strong>
            <span>
              {pending
                ? `${pending} steps in your care plan`
                : "Plan calls, visits, and family decisions"}
            </span>
          </span>
          <ArrowRight size={18} />
        </button>
      </div>
      <section
        className="care-search-guide"
        aria-labelledby="search-guide-heading"
      >
        <h2 id="search-guide-heading">
          A little clarity for the next conversation.
        </h2>
        <div>
          <p>
            <strong>Explore nearby care</strong>Choose a care setting or help at
            home. You can refine your search as you learn.
          </p>
          <p>
            <strong>Look at the details</strong>Compare services, public
            records, and family experiences, with sources attached.
          </p>
          <p>
            <strong>Make a connection</strong>Save your questions and confirm
            costs, availability, and care needs with the provider.
          </p>
        </div>
      </section>
    </div>
  );
}
