import type { SavedProviders } from "@/hooks/use-saved-providers";
import type { ReactNode } from "react";
import { ArrowRight, Bookmark, Download, Plus } from "lucide-react";
import { distanceMiles } from "@/lib/distance";
import type { SearchProvider, SearchResponse } from "@/lib/providers";
import styles from "./family-compare.module.css";

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
    <section
      className={styles.shortlist}
      aria-labelledby="family-shortlist-heading"
    >
      <header className={styles.shortlistHeading}>
        <div>
          <h1 id="family-shortlist-heading">Your shortlist</h1>
          <p>
            {savedCount} saved place{savedCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.outline} onClick={exportPlan}>
            <Download size={16} /> Export plan
          </button>
          <button className={styles.primary} onClick={findCare}>
            <Plus size={16} /> Find more care
          </button>
        </div>
      </header>
      {loadError && (
        <div className={styles.loadError} role="alert">
          <div>
            <strong>Your saved list is still here.</strong>
            <p>
              {loadError} Your {savedCount} saved option
              {savedCount === 1 ? " remains" : "s remain"} in your plan.
            </p>
          </div>
          <button className={styles.outline} onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {loading && providers.length < savedCount && (
        <p className={styles.loading} role="status">
          Loading your saved options… {providers.length} of {savedCount} details
          ready.
        </p>
      )}
      {providers.length > 0 ? (
        <>
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
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Bookmark size={32} />
          </span>
          <h2>No saved places yet.</h2>
          <p>Save places from your search to compare them here.</p>
          <button className={styles.primary} onClick={findCare}>
            Find care nearby <ArrowRight size={17} />
          </button>
        </div>
      ) : !loading && !loadError && providers.length < savedCount ? (
        <div className={styles.loadError} role="status">
          <div>
            <strong>Some saved details are unavailable.</strong>
            <p>
              Your saved list remains in your plan. Retry to check for current
              provider details.
            </p>
          </div>
          <button className={styles.outline} onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}
      {providers.length > 0 &&
        providers.length < savedCount &&
        !loading &&
        !loadError && (
          <div className={styles.loadError} role="status">
            <p>
              Showing {providers.length} of {savedCount} saved options. Some
              provider details are unavailable. Your saved list has not changed.
            </p>
            <button className={styles.outline} onClick={retry}>
              Try again
            </button>
          </div>
        )}
    </section>
  );
}
