"use client";

import { legacyMarket } from "@/lib/market-registration";
import { useEffect, useState } from "react";
import type { SearchResponse } from "@/lib/providers";
import type { Workspace } from "@/lib/workspace";

type SearchFields = {
  zip: string;
  radius: string;
  category: string;
  sort: string;
  q: string;
  evidence: string;
};

/** Keeps edits separate from the last submitted search and cancels stale requests. */
export function useCareSearch(profile: Workspace["profile"]) {
  const [draft, setDraft] = useState<SearchFields>(() => ({
    zip: profile.zip || legacyMarket.defaultZip,
    radius: "25",
    category: profile.careTypes.length === 1 ? profile.careTypes[0] : "all",
    sort: "distance",
    q: "",
    evidence: "all",
  }));
  const [request, setRequest] = useState(draft);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [displayCount, setDisplayCount] = useState(18);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/search?${new URLSearchParams(request)}`,
          {
            signal: controller.signal,
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Search is unavailable right now.");
        if (!controller.signal.aborted) setData(result);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Search is unavailable right now.",
        );
        setData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [request]);

  function edit(field: keyof SearchFields, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === "category" && value !== "nursing-home"
        ? { sort: "distance" }
        : {}),
    }));
  }

  function run(next = draft) {
    setLoading(true);
    setData(null);
    setError("");
    setDisplayCount(18);
    setRequest({ ...next, zip: next.zip.trim(), q: next.q.trim() });
  }

  function filter(patch: Partial<SearchFields>) {
    setDraft((current) => ({ ...current, ...patch }));
    run({ ...request, ...patch });
  }

  return {
    draft,
    request,
    data,
    loading,
    error,
    displayCount,
    edit,
    run,
    filter,
    changeCategory(category: string) {
      filter({
        category,
        sort: category === "nursing-home" ? draft.sort : "distance",
      });
    },
    widen() {
      filter({ category: "all", q: "", radius: "50", sort: "distance" });
    },
    showMore: () => setDisplayCount((count) => count + 18),
  };
}

export type CareSearch = ReturnType<typeof useCareSearch>;
