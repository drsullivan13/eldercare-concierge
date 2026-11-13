import { distanceMiles } from "./distance";
import {
  getMarket,
  getProviderMarket,
  marketIdentity,
  markets,
  type MarketRegistry,
} from "./markets";
import { getResearchSummary } from "./location-research";
import {
  CATEGORY_LABELS,
  type CareCategory,
  type Provider,
  type SearchProvider,
  type SearchResponse,
} from "./providers";
import { resolveSearchScope, SearchInputError } from "./search-scope";

export type SearchOptions = {
  zip?: string;
  radius?: string | number;
  category?: string;
  sort?: string;
  q?: string;
  evidence?: string;
};
export { SearchInputError } from "./search-scope";
export { BOSTON } from "./markets";
export const catalog: Provider[] = getMarket()!.providers;
const categoryKeys = Object.keys(CATEGORY_LABELS) as CareCategory[];

export { distanceMiles } from "./distance";
function optionsFrom(input: URLSearchParams | SearchOptions): SearchOptions {
  if (input instanceof URLSearchParams) {
    const allowed = ["zip", "radius", "category", "sort", "q", "evidence"];
    if (
      [...input.keys()].some(
        (key) => !allowed.includes(key) || input.getAll(key).length !== 1,
      )
    )
      throw new SearchInputError(
        "Supply each supported search parameter at most once.",
      );
    return Object.fromEntries(input.entries());
  }
  return input;
}
export function searchProviders(
  input: URLSearchParams | SearchOptions = {},
  records?: readonly Provider[],
  registry: MarketRegistry = markets,
): SearchResponse {
  const opts = optionsFrom(input);
  const { zip, market, point, radius, category } = resolveSearchScope(
    opts,
    registry,
  );
  const sort = opts.sort ?? "distance";
  if (!["distance", "cms-rating", "experience"].includes(sort))
    throw new SearchInputError(
      "Choose distance, cms-rating or experience sorting.",
    );
  if (sort === "experience" && category === "all")
    throw new SearchInputError(
      "Choose a care category before comparing consumer experience scores.",
    );
  if (sort === "cms-rating" && category !== "nursing-home")
    throw new SearchInputError(
      "CMS rating sorting is available only for the nursing-home category.",
    );
  const query = (opts.q ?? "").trim().toLocaleLowerCase("en-US");
  const evidence = opts.evidence ?? "all";
  if (
    ![
      "all",
      "details",
      "pricing",
      "openings",
      "reviews",
      "facebook",
      "unrated",
    ].includes(evidence)
  )
    throw new SearchInputError("Choose a supported research filter.");
  if (query.length > 200)
    throw new SearchInputError("Search text must be 200 characters or fewer.");
  const categories: Record<string, number> = Object.fromEntries(
    categoryKeys.map((key) => [key, 0]),
  );
  const providers: SearchProvider[] = [];
  const experienceCoverage = {
    scored: 0,
    unscored: 0,
    facebookFindings: 0,
    facebookCovered: 0,
  };
  let excludedWithoutCoordinates = 0;
  let catalogTotal = 0;
  for (const provider of records ?? market.providers) {
    if (provider.state !== market.state) continue;
    catalogTotal++;
    if (
      query &&
      !`${provider.name} ${provider.city}`
        .toLocaleLowerCase("en-US")
        .includes(query)
    )
      continue;
    const searchableCategories = [
      ...new Set([provider.category, ...(provider.searchCategories ?? [])]),
    ];
    const matchesCategory =
      category === "all" ||
      searchableCategories.includes(category as CareCategory);
    const distance =
      provider.lat === null ||
      provider.lng === null ||
      !Number.isFinite(provider.lat) ||
      !Number.isFinite(provider.lng)
        ? null
        : distanceMiles(point, { lat: provider.lat, lng: provider.lng });
    if (distance === null && !matchesCategory) continue;
    if (distance !== null && distance > radius) continue;
    const research =
      (evidence !== "all" || (matchesCategory && distance !== null)) &&
      getProviderMarket(provider.id, registry)?.id === market.id
        ? getResearchSummary(provider.id, registry)
        : undefined;
    if (evidence === "details" && !research?.detailsAvailable) continue;
    if (evidence === "pricing" && !research?.publishedCosts) continue;
    if (
      evidence === "openings" &&
      research?.availabilityStatus !== "opening-published"
    )
      continue;
    if (evidence === "reviews" && research?.experience.value == null) continue;
    if (evidence === "unrated" && research?.experience.value != null) continue;
    if (evidence === "facebook" && !research?.facebookResearch?.findingCount)
      continue;
    if (distance === null) {
      excludedWithoutCoordinates++;
      continue;
    }
    for (const key of searchableCategories) categories[key]++;
    if (matchesCategory) {
      providers.push({ ...provider, research, distanceMiles: distance });
      if (research?.experience.value != null) experienceCoverage.scored++;
      else experienceCoverage.unscored++;
      if ((research?.facebookResearch?.findingCount ?? 0) > 0)
        experienceCoverage.facebookFindings++;
      if (research?.facebookResearch) experienceCoverage.facebookCovered++;
    }
  }
  const byDistanceName = (a: SearchProvider, b: SearchProvider) =>
    a.distanceMiles! - b.distanceMiles! ||
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id, "en");
  providers.sort((a, b) => {
    let ratingDifference = 0;
    if (sort === "cms-rating") {
      ratingDifference = (b.cms?.overall ?? -1) - (a.cms?.overall ?? -1);
    } else if (sort === "experience") {
      ratingDifference =
        (b.research?.experience.value ?? -1) -
        (a.research?.experience.value ?? -1);
      if (
        ratingDifference === 0 &&
        a.research?.experience.value != null &&
        b.research?.experience.value != null
      )
        ratingDifference =
          (b.research?.familyExperience?.distinctThreadCount ?? 0) -
          (a.research?.familyExperience?.distinctThreadCount ?? 0);
    }
    return ratingDifference || byDistanceName(a, b);
  });
  return {
    market: marketIdentity(market),
    providers,
    total: providers.length,
    origin: { zip, ...point },
    radius,
    catalogTotal,
    asOf: market.meta.asOf,
    categories,
    excludedWithoutCoordinates,
    experienceCoverage,
  };
}
export function getProvidersByIds(
  ids: readonly string[],
  marketId?: string,
  registry: MarketRegistry = markets,
): Provider[] {
  return [...new Set(ids)].flatMap((id) => {
    const market = getProviderMarket(id, registry);
    if (!market || (marketId !== undefined && market.id !== marketId))
      return [];
    const provider = market.providers.find(
      (record) => record.id === id && record.state === market.state,
    );
    return provider
      ? [{ ...provider, research: getResearchSummary(provider.id, registry) }]
      : [];
  });
}
