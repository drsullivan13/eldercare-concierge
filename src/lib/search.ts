import { currentNjCoreqValue } from "./nj-coreq";
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
type MatchDetails = Pick<
  SearchProvider,
  "distanceMiles" | "serviceAreaMatch" | "research"
>;
type SearchMatch = MatchDetails & { provider: Provider };

function rankSearchMatches(
  input: URLSearchParams | SearchOptions = {},
  records?: readonly Provider[],
  registry: MarketRegistry = markets,
) {
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
  const providers: SearchMatch[] = [];
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
    const matchesCategory =
      category === "all" ||
      provider.category === category ||
      provider.searchCategories?.includes(category);
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
    categories[provider.category]++;
    if (provider.searchCategories?.length) {
      for (const key of new Set(provider.searchCategories)) {
        if (key !== provider.category) categories[key]++;
      }
    }
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
function fullProvider({ provider, ...match }: SearchMatch): SearchProvider {
  return { ...provider, ...match };
}

export function searchProviders(
  input: URLSearchParams | SearchOptions = {},
  records?: readonly Provider[],
  registry: MarketRegistry = markets,
): SearchResponse {
  const result = rankSearchMatches(input, records, registry);
  return { ...result, providers: result.providers.map(fullProvider) };
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
  const { market, providers, ...summary } = rankSearchMatches(params);
  const matches = providers.slice((page - 1) * pageSize, page * pageSize);
  const pageInfo = {
    markers:
      page === 1
        ? providers.map((match) => searchMarker(match.provider, match))
        : undefined,
    pagination: {
      page,
      pageSize,
      totalPages: Math.ceil(summary.total / pageSize),
      hasMore: page * pageSize < summary.total,
    },
    ...summary,
  };
  if (response === "cards") {
    const cards = matches.map((match) => cardFromMatch(match.provider, match));
    return { market, providers: cards, ...pageInfo };
  }
  return { market, providers: matches.map(fullProvider), ...pageInfo };
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
  return cardFromMatch(provider, provider);
}

function searchMarker(
  provider: Provider,
  { distanceMiles, serviceAreaMatch }: MatchDetails,
): SearchMarker {
  const { id, name, category, city, state, lat, lng, locationKind } = provider;
  return {
    id,
    name,
    category,
    city,
    state,
    lat,
    lng,
    locationKind,
    distanceMiles,
    ...(serviceAreaMatch && { serviceAreaMatch: true }),
  };
}

function cardFromMatch(provider: Provider, match: MatchDetails): SearchCard {
  return {
    ...searchMarker(provider, match),
    zip: provider.zip,
    services: provider.services,
    warnings: provider.warnings,
    ...(provider.cms && { cms: provider.cms }),
    ...(match.research && { research: match.research }),
    coreqPercent: currentNjCoreqValue(provider),
  };
}
