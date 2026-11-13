"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Provider } from "@/lib/providers";
import type { ProfilePane } from "../profile-pane";
import { Modal } from "../modal";
import { comparisonDemo } from "./comparison-demo";
import styles from "./demo-comparison.module.css";

const CompareContent = lazy(() =>
  import("./compare-content").then((module) => ({
    default: module.CompareContent,
  })),
);

type DemoResult =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; providers: Provider[] };

function DemoProviders({
  open,
}: {
  open: (provider: Provider, pane?: ProfilePane) => void;
}) {
  const [result, setResult] = useState<DemoResult>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({
          ids: comparisonDemo.providerIds.join(","),
          market: "north-jersey",
        });
        const response = await fetch(`/api/providers?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Demo unavailable");
        const body: { providers?: Provider[] } = await response.json();
        if (!Array.isArray(body.providers) || body.providers.length !== 2)
          throw new Error("Demo providers unavailable");
        const providers = comparisonDemo.providerIds.map((id) =>
          body.providers?.find((provider) => provider?.id === id),
        );
        if (
          providers.some(
            (provider) =>
              !provider ||
              provider.state !== "NJ" ||
              provider.category !== "assisted-living",
          )
        )
          throw new Error("Demo providers unavailable");
        if (!controller.signal.aborted)
          setResult({
            status: "ready",
            providers: providers.filter((provider) => provider !== undefined),
          });
      } catch {
        if (!controller.signal.aborted) setResult({ status: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  if (result.status === "loading")
    return <p role="status">Loading the North Jersey demo…</p>;
  if (result.status === "error")
    return (
      <div role="alert">
        <p>
          Could not load both demo providers. Your shortlist has not changed.
        </p>
        <button
          className="button button-outline"
          onClick={() => {
            setResult({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry demo
        </button>
      </div>
    );
  return (
    <Suspense fallback={<p role="status">Loading comparison…</p>}>
      <CompareContent providers={result.providers} open={open} />
    </Suspense>
  );
}

export function DemoComparison({
  showEntry,
  openProvider,
}: {
  showEntry: boolean;
  openProvider: (
    provider: Provider,
    pane?: ProfilePane,
    trigger?: HTMLElement,
  ) => void;
}) {
  const params = useSearchParams();
  const entry = useRef<HTMLAnchorElement>(null);
  const selector = comparisonDemo.selector;
  const active =
    params.getAll(selector.parameter).length === 1 &&
    params.get(selector.parameter) === selector.value;

  const demoParams = new URLSearchParams(params.toString());
  demoParams.set(selector.parameter, selector.value);
  function close(restoreFocus = true) {
    const url = new URL(window.location.href);
    url.searchParams.delete(selector.parameter);
    window.history.replaceState(null, "", url);
    if (restoreFocus)
      requestAnimationFrame(() =>
        entry.current?.focus({ preventScroll: true }),
      );
  }

  return (
    <>
      {showEntry && (
        <section
          className={styles.entry}
          aria-label="North Jersey comparison demo"
        >
          <div>
            <h2>See a real comparison</h2>
            <p>
              Arbor Terrace Morris Plains and Brighton Gardens of Florham Park.
              Compare assisted living prices, care details and published
              reviews.
            </p>
          </div>
          <Link
            ref={entry}
            href={`/dashboard?${demoParams}`}
            scroll={false}
            prefetch={false}
            className="button button-outline"
          >
            Open North Jersey demo
          </Link>
        </section>
      )}
      {active && (
        <Modal title="North Jersey comparison demo" close={() => close()} wide>
          <DemoProviders
            open={(provider, pane) => {
              close(false);
              openProvider(provider, pane, entry.current ?? undefined);
            }}
          />
        </Modal>
      )}
    </>
  );
}
