import { ArrowRight, Bookmark, ClipboardList, MapPin } from "lucide-react";
import Image from "next/image";
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
      <section className="care-search-home" aria-label="Search nearby care">
        <div className="page-heading compact">
          <h1>
            Find care for <em>your family.</em>
          </h1>
        </div>
        <div className="care-welcome-photo">
          <Image
            src="/images/porch-conversation.webp"
            alt="Two women sharing a conversation over mugs on a porch."
            width={1024}
            height={683}
            sizes="(max-width: 760px) 100vw, 50vw"
            preload
          />
        </div>
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
      </section>
      <div className="care-workspace-links">
        <button
          onClick={() => navigate("shortlist")}
          aria-label="Open shortlist"
        >
          <Bookmark size={22} />
          <span>
            <strong>Your shortlist</strong>
            {workspace.savedProviderIds.length > 0 && (
              <span>
                {workspace.savedProviderIds.length} saved options to compare
              </span>
            )}
          </span>
          <ArrowRight size={18} />
        </button>
        <button onClick={() => navigate("plan")} aria-label="Open your plan">
          <ClipboardList size={22} />
          <span>
            <strong>Your next steps</strong>
            {pending > 0 && <span>{pending} steps in your care plan</span>}
          </span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
