"use client";

import { DEFAULT_DASHBOARD_SEARCH_ZIP } from "@/lib/dashboard-defaults";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompactSearchResponse,
  Provider,
  SearchMarker,
  SearchResponse,
} from "@/lib/providers";
import type { Workspace } from "@/lib/workspace";

type SearchFields = {
  zip: string;
  radius: string;
  category: string;
  sort: string;
  q: string;
  evidence: string;
};

function compatibleEvidence(fields: SearchFields): SearchFields {
  return fields.category !== "home-care" && fields.evidence === "service-area"
    ? { ...fields, evidence: "all" }
    : fields;
}

/** Keeps edits separate from the last submitted search and cancels stale requests. */
export function useCareSearch(profile: Workspace["profile"]) {
  const [draft, setDraft] = useState<SearchFields>(() => ({
    zip: profile.zip.trim() || DEFAULT_DASHBOARD_SEARCH_ZIP,
    radius: "25",
    category:
      profile.careTypes.length === 0
        ? "home-care"
        : profile.careTypes.length === 1
          ? profile.careTypes[0]
          : "all",
    sort: "distance",
    q: "",
    evidence: "all",
  }));
  const [request, setRequest] = useState(draft);
  const submitted = useRef<{
    fields: SearchFields;
    status: "pending" | "succeeded" | "failed";
  }>({ fields: request, status: "pending" });
  const [data, setData] = useState<
    SearchResponse | CompactSearchResponse | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [displayCount, setDisplayCount] = useState(18);

  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState("");
  const pageRequest = useRef<AbortController | null>(null);
  const providerRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted && submitted.current.fields === request;
    async function load() {
      try {
        const response = await fetch(
          `/api/search?${new URLSearchParams({ ...request, response: "compact", page: "1", pageSize: "18" })}`,
          {
            signal: controller.signal,
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Search is unavailable right now.");
        if (current()) {
          submitted.current.status = "succeeded";
          setData(result);
        }
      } catch (cause) {
        if (!current()) return;
        submitted.current.status = "failed";
        setError(
          cause instanceof Error
            ? cause.message
            : "Search is unavailable right now.",
        );
        setData(null);
      } finally {
        if (current()) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      pageRequest.current?.abort();
      providerRequest.current?.abort();
    };
  }, [request]);

  function edit(field: keyof SearchFields, value: string) {
    setDraft((current) =>
      compatibleEvidence({
        ...current,
        [field]: value,
        ...(field === "category" && value !== "nursing-home"
          ? { sort: "distance" }
          : {}),
      }),
    );
  }

  function run(next = draft) {
    const fields = compatibleEvidence({
      ...next,
      zip: next.zip.trim(),
      q: next.q.trim(),
    });
    if (
      submitted.current.status !== "failed" &&
      (Object.keys(fields) as (keyof SearchFields)[]).every(
        (field) => fields[field] === submitted.current.fields[field],
      )
    )
      return;
    pageRequest.current?.abort();
    pageRequest.current = null;
    providerRequest.current?.abort();
    setDisplayCount(18);
    setPageLoading(false);
    setPageError("");
    setProviderLoading(false);
    setProviderError("");
    submitted.current = { fields, status: "pending" };
    setLoading(true);
    setData(null);
    setError("");
    setRequest(fields);
  }

  function filter(patch: Partial<SearchFields>) {
    setDraft((current) => compatibleEvidence({ ...current, ...patch }));
    run({ ...submitted.current.fields, ...patch });
  }

  const pagination = data && "pagination" in data ? data.pagination : null;
  const markers =
    data && "markers" in data ? (data.markers ?? []) : (data?.providers ?? []);

  async function showMore() {
    if (!data || pageRequest.current) return;
    if (!pagination) {
      setDisplayCount((count) => count + 18);
      return;
    }
    if (!pagination.hasMore) return;
    const fields = submitted.current.fields;
    const controller = new AbortController();
    pageRequest.current = controller;
    setPageLoading(true);
    setPageError("");
    const current = () =>
      !controller.signal.aborted && submitted.current.fields === fields;
    try {
      const response = await fetch(
        `/api/search?${new URLSearchParams({
          ...fields,
          response: "compact",
          page: String(pagination.page + 1),
          pageSize: "18",
        })}`,
        { signal: controller.signal },
      );
      const result: CompactSearchResponse & { error?: string } =
        await response.json();
      if (!response.ok)
        throw new Error(result.error || "More options could not be loaded.");
      if (result.pagination?.page !== pagination.page + 1)
        throw new Error("More options could not be loaded.");
      if (!current()) return;
      setData((previous) => {
        if (!previous) return previous;
        const ids = new Set(previous.providers.map((provider) => provider.id));
        return {
          ...previous,
          pagination: result.pagination,
          providers: [
            ...previous.providers,
            ...result.providers.filter((provider) => !ids.has(provider.id)),
          ],
        };
      });
      setDisplayCount((count) => count + 18);
    } catch (cause) {
      if (current())
        setPageError(
          cause instanceof Error
            ? cause.message
            : "More options could not be loaded.",
        );
    } finally {
      if (pageRequest.current === controller) pageRequest.current = null;
      if (current()) setPageLoading(false);
    }
  }

  const cancelProviderLookup = useCallback(() => {
    providerRequest.current?.abort();
    setProviderLoading(false);
    setProviderError("");
  }, []);

  const openMarker = useCallback(
    async (marker: SearchMarker, onOpen: (provider: Provider) => void) => {
      if (!data) return;
      providerRequest.current?.abort();
      const controller = new AbortController();
      providerRequest.current = controller;
      const fields = submitted.current.fields;
      const current = () =>
        !controller.signal.aborted && submitted.current.fields === fields;
      setProviderError("");
      const loaded = data.providers.find(
        (provider) => provider.id === marker.id,
      );
      if (loaded) {
        setProviderLoading(false);
        onOpen(loaded);
        return;
      }
      setProviderLoading(true);
      try {
        const response = await fetch(
          `/api/providers?${new URLSearchParams({ ids: marker.id, market: data.market.id })}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            "This option could not be opened. Select it again to retry.",
          );
        const result: { providers: Provider[] } = await response.json();
        const provider = result.providers.find((item) => item.id === marker.id);
        if (!provider)
          throw new Error(
            "This option could not be opened. Select it again to retry.",
          );
        if (current()) onOpen(provider);
      } catch (cause) {
        if (current())
          setProviderError(
            cause instanceof Error
              ? cause.message
              : "This option could not be opened.",
          );
      } finally {
        if (current()) setProviderLoading(false);
      }
    },
    [data],
  );

  return {
    draft,
    request,
    data,
    loading,
    error,
    displayCount,
    markers,
    hasMore: pagination
      ? pagination.hasMore
      : !!data && displayCount < data.providers.length,
    pageLoading,
    pageError,
    providerLoading,
    providerError,
    openMarker,
    cancelProviderLookup,
    edit,
    discardDraft: () => setDraft(request),
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
    showMore,
  };
}

export type CareSearch = ReturnType<typeof useCareSearch>;
