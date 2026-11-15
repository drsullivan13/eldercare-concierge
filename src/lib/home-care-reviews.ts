import { isDeepStrictEqual } from "node:util";
import type { MarketSnapshot } from "./markets";
import type { LocationResearch } from "./location-research-types";
import type { Provider } from "./providers";
import type { ReviewCatalog } from "./review-catalog-types";

type Supplement = {
  schemaVersion: number;
  batchId: string;
  asOf: string;
  reviewedInputSha256: string;
  providers: Record<
    string,
    Pick<
      LocationResearch,
      "sources" | "reviewAggregates" | "reviews" | "reviewSamples" | "notes"
    > & {
      identity: Pick<
        Provider,
        "id" | "name" | "address" | "city" | "state" | "zip" | "category"
      >;
      catalog: ReviewCatalog;
    }
  >;
};

function page(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|tracking|gclid|fbclid)$/i.test(key))
      url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return `${url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function accountUrl(value: string): string {
  const url = new URL(value);
  if (
    ["google.com", "www.google.com", "maps.google.com"].includes(url.hostname)
  ) {
    const native = decodeURIComponent(value).match(/!1s((?:Ci|Ch)[^!?#]+)/);
    if (native) return `google:${native[1]}`;
  }
  return value;
}

function appendUnique<T>(
  current: readonly T[],
  additions: readonly T[],
  key: (value: T) => string,
): T[] {
  const result = [...current];
  for (const addition of additions) {
    const prior = result.find((item) => key(item) === key(addition));
    if (prior && !isDeepStrictEqual(prior, addition))
      throw new Error("Conflicting home-care review release ID.");
    if (!prior) result.push(addition);
  }
  return result;
}

export function mergeHomeCareReviews(
  snapshots: readonly MarketSnapshot[],
  baseCatalogs: Record<string, ReviewCatalog>,
  supplement: Supplement,
): {
  snapshots: readonly MarketSnapshot[];
  catalogs: Record<string, ReviewCatalog>;
} {
  if (supplement.schemaVersion !== 1)
    throw new Error("Unknown home-care review supplement version.");
  if (!Object.keys(supplement.providers).length)
    return { snapshots, catalogs: baseCatalogs };
  const catalogs = { ...baseCatalogs };
  const remaining = new Set(Object.keys(supplement.providers));
  const merged = snapshots.map((market) => {
    const entries = Object.entries(supplement.providers).filter(([pid]) =>
      market.providers.some((provider) => provider.id === pid),
    );
    if (!entries.length) return market;
    const records = { ...market.locationResearch };
    for (const [pid, patch] of entries) {
      const provider = market.providers.find((item) => item.id === pid)!;
      if (
        market.id !== "north-jersey" ||
        !/^north-jersey-hp-hp\d+$/.test(pid) ||
        provider.category !== "home-care" ||
        provider.state !== "NJ" ||
        patch.catalog.providerId !== pid ||
        Object.entries(patch.identity).some(
          ([key, value]) => provider[key as keyof Provider] !== value,
        ) ||
        Object.keys(patch.identity).length !== 7
      )
        throw new Error("Home-care review supplement identity drift.");
      const record =
        records[pid] ??
        ({
          providerId: pid,
          checkedAt: null,
          providerDetailsReviewed: false,
          sources: [],
          facts: [],
          reviews: [],
          reviewAggregates: [],
          availability: {
            status: "not-published",
            text: "Current availability has not been researched for this location. Contact the provider to confirm openings and waitlist timing.",
            sourceId: null,
            asOf: null,
          },
          notes: [],
        } satisfies LocationResearch);
      const priorCatalog = catalogs[pid];
      const catalog: ReviewCatalog = structuredClone(
        priorCatalog ?? {
          providerId: pid,
          checkedAt: patch.catalog.checkedAt,
          sources: [],
          accounts: [],
          notes: [],
        },
      );
      const sourceAliases = new Map<string, string>();
      for (const source of patch.catalog.sources) {
        if (
          catalog.sources.some(
            (item) =>
              page(item.url) === page(source.url) &&
              item.sourceFamily !== source.sourceFamily,
          )
        )
          throw new Error("Conflicting home-care catalog page family.");
        const idMatch = catalog.sources.find((item) => item.id === source.id);
        if (
          idMatch &&
          (page(idMatch.url) !== page(source.url) ||
            idMatch.sourceFamily !== source.sourceFamily)
        )
          throw new Error("Conflicting home-care catalog source ID.");
        const prior = catalog.sources.find(
          (item) =>
            page(item.url) === page(source.url) &&
            item.sourceFamily === source.sourceFamily,
        );
        if (prior) {
          sourceAliases.set(source.id, prior.id);
          if (patch.catalog.checkedAt >= catalog.checkedAt) {
            Object.assign(prior, source, {
              id: prior.id,
              reportedCount: source.reportedCount ?? prior.reportedCount,
            });
          }
        } else {
          catalog.sources.push({ ...source });
          sourceAliases.set(source.id, source.id);
        }
      }
      const reviewAliases = new Map<string, string>();
      for (const account of patch.catalog.accounts) {
        const prior = catalog.accounts.find(
          (item) =>
            item.id === account.id ||
            (item.sourceFamily === account.sourceFamily &&
              (accountUrl(item.url) === accountUrl(account.url) ||
                (Boolean(account.nativeReviewId) &&
                  item.nativeReviewId === account.nativeReviewId))),
        );
        const sourceId = sourceAliases.get(account.sourceId);
        if (!sourceId) throw new Error("Unlinked home-care catalog account.");
        if (prior) {
          if (
            prior.sourceFamily !== account.sourceFamily ||
            accountUrl(prior.url) !== accountUrl(account.url) ||
            prior.date !== account.date ||
            prior.datePrecision !== account.datePrecision ||
            (prior.excerpt && prior.excerpt !== account.excerpt) ||
            (prior.summary && prior.summary !== account.summary)
          )
            throw new Error("Conflicting home-care account identity or text.");
          reviewAliases.set(account.id, prior.id);
          if (
            !prior.excerpt &&
            !prior.summary &&
            (account.excerpt || account.summary)
          )
            Object.assign(prior, account, {
              id: prior.id,
              sourceId,
              nativeReviewId: prior.nativeReviewId ?? account.nativeReviewId,
            });
        } else {
          const retained = record.reviews.find(
            (item) =>
              item.id === account.id ||
              (accountUrl(item.url).startsWith("google:") &&
                accountUrl(item.url) === accountUrl(account.url)),
          );
          if (
            retained &&
            (accountUrl(retained.url) !== accountUrl(account.url) ||
              retained.date !== account.date)
          )
            throw new Error("Conflicting retained home-care account identity.");
          if (retained) reviewAliases.set(account.id, retained.id);
          catalog.accounts.push({
            ...account,
            id: retained?.id ?? account.id,
            sourceId,
          });
        }
      }
      for (const source of catalog.sources) {
        source.retainedCount = catalog.accounts.filter(
          (account) => account.sourceId === source.id,
        ).length;
        const original = priorCatalog?.sources.find(
          (item) => item.id === source.id,
        );
        const previousIds = new Set(
          priorCatalog?.accounts
            .filter((account) => account.sourceId === source.id)
            .map((account) => account.id),
        );
        const added = catalog.accounts.filter(
          (account) =>
            account.sourceId === source.id && !previousIds.has(account.id),
        ).length;
        source.previouslyUnseenCount = Math.min(
          source.retainedCount,
          (original?.previouslyUnseenCount ?? 0) + added,
        );
      }
      catalog.checkedAt = [catalog.checkedAt, patch.catalog.checkedAt]
        .sort()
        .at(-1)!;
      catalog.notes = [...new Set([...catalog.notes, ...patch.catalog.notes])];
      catalogs[pid] = catalog;
      records[pid] = {
        ...record,
        sources: appendUnique(record.sources, patch.sources, (item) => item.id),
        reviewAggregates: appendUnique(
          record.reviewAggregates,
          patch.reviewAggregates,
          (item) => item.sourceId,
        ),
        reviews: appendUnique(
          record.reviews,
          patch.reviews.map((review) => ({
            ...review,
            id: reviewAliases.get(review.id) ?? review.id,
          })),
          (item) => item.id,
        ),
        reviewSamples: appendUnique(
          record.reviewSamples ?? [],
          patch.reviewSamples ?? [],
          (item) => item.sourceId,
        ),
        notes: [...new Set([...record.notes, ...patch.notes])],
      };
      remaining.delete(pid);
    }
    return { ...market, locationResearch: records };
  });
  if (remaining.size)
    throw new Error("Home-care supplement references an unpublished provider.");
  return { snapshots: merged, catalogs };
}
