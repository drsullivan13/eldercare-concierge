import { currentNjCoreqValue } from "../components/nj-coreq";
import { providerDistanceMiles } from "./distance";
import {
  getMarket,
  getProviderEntry,
  getProviderMarket,
  marketIdentity,
  markets,
  type MarketRegistry,
} from "./markets";
import { getResearchSummary } from "./location-research";
import { providerSearchText } from "./provider-search-text";
import {
  CATEGORY_LABELS,
  matchesHomeCareServiceArea,
  type CareCategory,
  type Provider,
  type SearchProvider,
  type SearchCard,
  type CardSearchResponse,
  type SearchResponse,
  type CompactSearchResponse,
  type SearchMarker,
} from "./providers";
import {
  compareSearchNames,
  resolveSearchScope,
  searchParameters,
  SearchInputError,
} from "./search-scope";

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
function runSearch(
  input: URLSearchParams | SearchOptions = {},
  records?: readonly Provider[],
  registry: MarketRegistry = markets,
  page?: { page: number; pageSize: number },
): SearchResponse | CompactSearchResponse | CardSearchResponse {
  const opts =
    input instanceof URLSearchParams
      ? searchParameters(input, "search")
      : input;
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
      "service-area",
      "pricing",
      "openings",
      "reviews",
      "facebook",
      "unrated",
    ].includes(evidence)
  )
    throw new SearchInputError("Choose a supported research filter.");
  if (evidence === "service-area" && category !== "home-care")
    throw new SearchInputError(
      "Service-area filtering is available for in-home care.",
    );
  if (query.length > 200)
    throw new SearchInputError("Search text must be 200 characters or fewer.");
  const categories: Record<string, number> = Object.fromEntries(
    categoryKeys.map((key) => [key, 0]),
  );
  const providers: {
    provider: Provider;
    research: SearchProvider["research"];
    distanceMiles: number | null;
    serviceAreaMatch?: boolean;
  }[] = [];
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
    if (query && !providerSearchText(provider).includes(query)) continue;
    const searchableCategories = [
      ...new Set([provider.category, ...(provider.searchCategories ?? [])]),
    ];
    const matchesCategory =
      category === "all" ||
      searchableCategories.includes(category as CareCategory);
    const serviceAreaMatch = matchesHomeCareServiceArea(
      provider,
      zip,
      category,
    );
    if (evidence === "service-area" && !serviceAreaMatch) continue;
    const distance = providerDistanceMiles(point, provider);
    if (distance === null && !matchesCategory) continue;
    if (distance !== null && distance > radius && !serviceAreaMatch) continue;
    const research =
      (evidence !== "all" ||
        (matchesCategory && (distance !== null || serviceAreaMatch))) &&
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
    if (distance === null && !serviceAreaMatch) {
      excludedWithoutCoordinates++;
      continue;
    }
    for (const key of searchableCategories) categories[key]++;
    if (matchesCategory) {
      providers.push({
        provider,
        research,
        distanceMiles: distance,
        ...(serviceAreaMatch && { serviceAreaMatch: true }),
      });
      if (research?.experience.value != null) experienceCoverage.scored++;
      else experienceCoverage.unscored++;
      if ((research?.facebookResearch?.findingCount ?? 0) > 0)
        experienceCoverage.facebookFindings++;
      if (research?.facebookResearch) experienceCoverage.facebookCovered++;
    }
  }
  const byDistanceName = (
    a: (typeof providers)[number],
    b: (typeof providers)[number],
  ) =>
    (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
    compareSearchNames(a.provider.name, b.provider.name) ||
    a.provider.id.localeCompare(b.provider.id, "en");
  providers.sort((a, b) => {
    let ratingDifference = 0;
    if (sort === "cms-rating") {
      ratingDifference =
        (b.provider.cms?.overall ?? -1) - (a.provider.cms?.overall ?? -1);
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
    providers: (page
      ? providers.slice(
          (page.page - 1) * page.pageSize,
          page.page * page.pageSize,
        )
      : providers
    ).map(({ provider, ...match }) => ({ ...provider, ...match })),
    ...(page && {
      markers:
        page.page === 1
          ? providers.map<SearchMarker>(
              ({ provider, distanceMiles, serviceAreaMatch }) => ({
                id: provider.id,
                name: provider.name,
                category: provider.category,
                city: provider.city,
                state: provider.state,
                lat: provider.lat,
                lng: provider.lng,
                locationKind: provider.locationKind,
                distanceMiles,
                ...(serviceAreaMatch && { serviceAreaMatch: true }),
              }),
            )
          : undefined,
      pagination: {
        ...page,
        totalPages: Math.ceil(providers.length / page.pageSize),
        hasMore: page.page * page.pageSize < providers.length,
      },
    }),
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
export function searchProviders(
  input: URLSearchParams | SearchOptions = {},
  records?: readonly Provider[],
  registry: MarketRegistry = markets,
): SearchResponse {
  return runSearch(input, records, registry) as SearchResponse;
}

/** Opt-in HTTP shape; all legacy parameters remain validated by the search parser. */
export function searchResponse(
  input: URLSearchParams,
): SearchResponse | CompactSearchResponse | CardSearchResponse {
  const params = new URLSearchParams(input);
  const response = params.get("response");
  const hasPagination = params.has("page") || params.has("pageSize");
  if (response === null && !hasPagination) return searchProviders(params);
  if (
    !["compact", "cards"].includes(response ?? "") ||
    params.getAll("response").length !== 1
  )
    throw new SearchInputError("Use response=compact for paginated search.");
  const integer = (key: string, fallback: number, max: number) => {
    if (!params.has(key)) return fallback;
    const raw = params.get(key)!;
    if (
      params.getAll(key).length !== 1 ||
      !/^[1-9]\d*$/.test(raw) ||
      Number(raw) > max
    )
      throw new SearchInputError(`${key} must be an integer from 1 to ${max}.`);
    return Number(raw);
  };
  const page = integer("page", 1, 10000);
  const pageSize = integer("pageSize", 18, 48);
  for (const key of ["response", "page", "pageSize"]) params.delete(key);
  const result = runSearch(params, undefined, markets, {
    page,
    pageSize,
  }) as CompactSearchResponse;
  if (response !== "cards") return result;
  return { ...result, providers: result.providers.map(projectSearchCard) };
}

export function getProvidersByIds(
  ids: readonly string[],
  marketId?: string,
  registry: MarketRegistry = markets,
): Provider[] {
  return [...new Set(ids)].flatMap((id) => {
    const entry = getProviderEntry(id, registry);
    if (!entry || (marketId !== undefined && entry.market.id !== marketId))
      return [];
    return [{ ...entry.provider, research: getResearchSummary(id, registry) }];
  });
}

/** Keep rich source records out of the card response without changing legacy search. */
export function projectSearchCard(provider: SearchProvider): SearchCard {
  const {
    id,
    name,
    category,
    city,
    state,
    zip,
    lat,
    lng,
    locationKind,
    distanceMiles,
    serviceAreaMatch,
    services,
    warnings,
    cms,
    research,
  } = provider;
  return {
    id,
    name,
    category,
    city,
    state,
    zip,
    lat,
    lng,
    locationKind,
    distanceMiles,
    ...(serviceAreaMatch && { serviceAreaMatch }),
    services,
    warnings,
    ...(cms && { cms }),
    ...(research && { research }),
    coreqPercent: currentNjCoreqValue(provider),
  };
}
