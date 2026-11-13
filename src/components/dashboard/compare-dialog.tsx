import { lazy, Suspense, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "../modal";
import type { Provider } from "@/lib/providers";
import type { ProfilePane } from "../profile-pane";
import styles from "./family-compare.module.css";

const CompareContent = lazy(() =>
  import("./compare-content").then((module) => ({
    default: module.CompareContent,
  })),
);

/** Keep selected records available when a filter removes them from the result list. */
export function useComparison() {
  const [providers, setProviders] = useState<Provider[]>([]);
  return {
    providers,
    contains: (id: string) => providers.some((provider) => provider.id === id),
    clear: () => setProviders([]),
    toggle(provider: Provider) {
      if (providers.some((selected) => selected.id === provider.id)) {
        setProviders((current) =>
          current.filter((selected) => selected.id !== provider.id),
        );
      } else {
        if (providers.length >= 3) return false;
        setProviders((current) => [...current, provider]);
      }
      return true;
    },
  };
}

export function ComparisonTray({
  comparison,
  openProvider,
}: {
  comparison: ReturnType<typeof useComparison>;
  openProvider: (
    provider: Provider,
    pane?: ProfilePane,
    trigger?: HTMLElement,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const compareButton = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => {
      compareButton.current?.focus({ preventScroll: true });
    });
  }
  if (!comparison.providers.length) return null;
  return (
    <>
      <div className={styles.tray} aria-label="Comparison selections">
        <span aria-live="polite">
          <strong>{comparison.providers.length}</strong> of 3 selected
        </span>
        <button className={styles.link} onClick={comparison.clear}>
          Clear
        </button>
        <button
          ref={compareButton}
          className={styles.primary}
          disabled={comparison.providers.length < 2}
          onClick={() => setOpen(true)}
        >
          Compare <ArrowRight size={16} />
        </button>
      </div>
      {open && (
        <Modal title="Compare places" close={close} wide>
          <Suspense fallback={<p role="status">Loading comparison…</p>}>
            <CompareContent
              providers={comparison.providers}
              open={(provider, pane) => {
                setOpen(false);
                openProvider(
                  provider,
                  pane,
                  compareButton.current ?? undefined,
                );
              }}
            />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
