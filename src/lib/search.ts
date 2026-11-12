import { distanceMiles } from "./distance";
import prefixData from "@/data/us-zip-prefix-states.json";
import {
  BOSTON,
  MASSACHUSETTS_ORIGIN_RADIUS_MILES,
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

export type SearchOptions = {
  zip?: string;
  radius?: string | number;
  category?: string;
  sort?: string;
  q?: string;
  evidence?: string;
};
export class SearchInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}
export { BOSTON } from "./markets";
export const catalog: Provider[] = getMarket()!.providers;
const prefixes = prefixData as Record<string, string[]>;
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
  const zip = opts.zip === undefined ? "02459" : opts.zip.trim();
  if (!/^\d{5}$/.test(zip))
    throw new SearchInputError(
      "Enter a five-digit ZIP code, including its leading zero.",
    );
  const market = registry.find((entry) => Object.hasOwn(entry.zips, zip));
  if (!market) {
    const states = prefixes[zip.slice(0, 3)];
    if (states?.includes("NJ"))
      throw new SearchInputError(
        getMarket("north-jersey", registry)
          ? "This ZIP is not recognized in the published North Jersey coverage. It may be invalid or outside the covered counties. Check it or try a nearby covered ZIP."
          : "North Jersey coverage is pending for this ZIP. No reviewed ZIP and provider snapshot is available for it.",
      );
    if (states && !states.includes("MA"))
      throw new SearchInputError(
        "This ZIP is outside the supported Massachusetts and North Jersey markets.",
      );
    throw new SearchInputError(
      "This ZIP is not recognized in the reviewed market ZIP datasets. Check it or try a nearby ZIP.",
    );
  }
  const point = market.zips[zip];
  if (
    market.id === "massachusetts" &&
    distanceMiles(BOSTON, point) > MASSACHUSETTS_ORIGIN_RADIUS_MILES
  )
    throw new SearchInputError(
      "This ZIP is outside the Boston pilot area (55 straight-line miles from Boston).",
    );
  const rawRadius =
    opts.radius === undefined ? "25" : String(opts.radius).trim();
  const radius = Number(rawRadius);
  if (
    !/^\d+(?:\.\d+)?$/.test(rawRadius) ||
    !Number.isFinite(radius) ||
    radius < 1 ||
    radius > 50
  )
    throw new SearchInputError("Radius must be a number from 1 to 50 miles.");
  const category = opts.category ?? "all";
  if (category !== "all" && !categoryKeys.includes(category as CareCategory))
    throw new SearchInputError("Choose a supported care category.");
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
  const scopedRecords = (records ?? market.providers).filter(
    (provider) => provider.state === market.state,
  );
  for (const provider of scopedRecords) {
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
  providers.sort((a, b) =>
    sort === "cms-rating"
      ? (b.cms?.overall ?? -1) - (a.cms?.overall ?? -1) || byDistanceName(a, b)
      : sort === "experience"
        ? (b.research?.experience.value ?? -1) -
            (a.research?.experience.value ?? -1) || byDistanceName(a, b)
        : byDistanceName(a, b),
  );
  return {
    market: marketIdentity(market),
    providers,
    total: providers.length,
    origin: { zip, ...point },
    radius,
    catalogTotal: scopedRecords.length,
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
