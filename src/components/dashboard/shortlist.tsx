import type { SavedProviders } from "@/hooks/use-saved-providers";
import type { ReactNode } from "react";
import { ArrowRight, Bookmark, Download, Plus } from "lucide-react";
import { distanceMiles } from "@/lib/distance";
import type { SearchProvider, SearchResponse } from "@/lib/providers";

export function ShortlistView({
  saved,
  origin,
  cards,
  findCare,
  exportPlan,
}: {
  saved: SavedProviders;
  origin?: SearchResponse["origin"];
  cards: (providers: SearchProvider[]) => ReactNode;
  findCare: () => void;
  exportPlan: () => void;
}) {
  const {
    providers,
    count: savedCount,
    loading,
    error: loadError,
    retry,
  } = saved;
  return (
    <>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">A THOUGHTFUL SHORTLIST</span>
          <h1>
            Keep the <em>possibilities.</em>
          </h1>
          <p>
            Your saved options, source trails and questions—all in one place.
          </p>
        </div>
        <button className="button button-outline" onClick={exportPlan}>
          <Download size={16} /> Export plan
        </button>
      </div>
      {loadError && (
        <div className="form-error" role="alert">
          {loadError}{" "}
          <button className="text-link" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {loading && providers.length < savedCount && (
        <p role="status">Loading your saved options…</p>
      )}
      {providers.length > 0 ? (
        <>
          <div className="results-toolbar">
            <div>
              <strong>
                {providers.length} saved option
                {providers.length === 1 ? "" : "s"}
              </strong>
              <span>Select up to three to compare side by side.</span>
            </div>
            <button
              className="button button-outline"
              onClick={() => findCare()}
            >
              <Plus size={16} /> Find more care
            </button>
          </div>
          <div className="provider-grid">
            {cards(
              providers.map((p) => ({
                ...p,
                distanceMiles:
                  origin && p.lat !== null && p.lng !== null
                    ? distanceMiles(origin, {
                        lat: p.lat,
                        lng: p.lng,
                      })
                    : null,
              })),
            )}
          </div>
        </>
      ) : savedCount === 0 ? (
        <div className="empty-state shortlist-empty">
          <span className="empty-icon">
            <Bookmark size={32} />
          </span>
          <h2>A good shortlist starts with one option.</h2>
          <p>
            Save resources as you explore. Their sources and your questions will
            stay together here.
          </p>
          <button className="button button-primary" onClick={() => findCare()}>
            Find care nearby <ArrowRight size={17} />
          </button>
        </div>
      ) : null}
    </>
  );
}
