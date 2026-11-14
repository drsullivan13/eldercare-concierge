import { useEffect, useState } from "react";

interface ProviderEvidenceSource<T> {
  path: string;
  idParameter: string;
  unavailable: string;
  notFound?: string | null;
  mismatched: string;
  fallback: string;
  validate?: (data: unknown, providerId: string) => data is T;
}

export function useProviderEvidence<T extends { providerId: string }>(
  providerId: string,
  source: ProviderEvidenceSource<T>,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  const key = `${source.path}:${providerId}:${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({
          [source.idParameter]: providerId,
        });
        const response = await fetch(`${source.path}?${params}`, {
          signal: controller.signal,
        });
        if (response.status === 404 && source.notFound === null) {
          if (!controller.signal.aborted) setResult({ key });
          return;
        }
        if (!response.ok) {
          throw new Error(
            response.status === 404 && source.notFound
              ? source.notFound
              : source.unavailable,
          );
        }
        const data = (await response.json()) as T;
        if (source.validate && !source.validate(data, providerId))
          throw new Error(source.mismatched);
        if (data.providerId !== providerId) throw new Error(source.mismatched);
        if (!controller.signal.aborted) setResult({ key, data });
      } catch (reason) {
        if (!controller.signal.aborted)
          setResult({
            key,
            error: reason instanceof Error ? reason.message : source.fallback,
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [key, providerId, source]);

  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    retry: () => setAttempt((value) => value + 1),
  };
}
