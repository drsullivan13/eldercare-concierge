"use client";

import { useEffect, useState } from "react";
import type { Provider } from "@/lib/providers";

/** Resolves saved IDs without conflating a failed lookup with an empty shortlist. */
export function useSavedProviders(ids: string[]) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({
    key: "",
    providers: [] as Provider[],
    error: "",
  });
  const savedIds = ids.join(",");
  const key = `${savedIds}:${attempt}`;
  useEffect(() => {
    if (!savedIds) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/providers?${new URLSearchParams({ ids: savedIds })}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error("Your saved providers could not be loaded.");
        const body = await response.json();
        if (!controller.signal.aborted)
          setResult({ key, providers: body.providers, error: "" });
      } catch (cause) {
        if (!controller.signal.aborted)
          setResult((previous) => ({
            ...previous,
            key,
            error:
              cause instanceof Error
                ? cause.message
                : "Your saved providers could not be loaded.",
          }));
      }
    }
    void load();
    return () => controller.abort();
  }, [key, savedIds]);
  return {
    providers: result.providers.filter((provider) => ids.includes(provider.id)),
    count: ids.length,
    loading: ids.length > 0 && result.key !== key,
    error: ids.length > 0 && result.key === key ? result.error : "",
    retry: () => setAttempt((value) => value + 1),
  };
}

export type SavedProviders = ReturnType<typeof useSavedProviders>;
