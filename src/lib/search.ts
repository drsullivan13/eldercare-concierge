import { distanceMiles } from "./distance";
import providerData from "@/data/providers.json";
import zipData from "@/data/ma-zips.json";
import prefixData from "@/data/us-zip-prefix-states.json";
import meta from "@/data/catalog-meta.json";
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
export const BOSTON = { lat: 42.3601, lng: -71.0589 };
export const PILOT_RADIUS_MILES = 55;
export const catalog: Provider[] = providerData as Provider[];
const byId = new Map(catalog.map((provider) => [provider.id, provider]));
const zips = zipData as Record<
  string,
  { city: string; lat: number; lng: number }
>;
const prefixes = prefixData as Record<string, string[]>;
const categoryKeys = Object.keys(CATEGORY_LABELS) as CareCategory[];

export { distanceMiles } from "./distance";
function optionsFrom(input: URLSearchParams | SearchOptions): SearchOptions {
  if (input instanceof URLSearchParams)
    return Object.fromEntries(input.entries());
  return input;
}
export function searchProviders(
  input: URLSearchParams | SearchOptions = {},
  records: readonly Provider[] = catalog,
): SearchResponse {
  const opts = optionsFrom(input);
  const zip = opts.zip === undefined ? "02459" : opts.zip.trim();
  if (!/^\d{5}$/.test(zip))
    throw new SearchInputError(
      "Enter a five-digit ZIP code, including its leading zero.",
    );
  const point = Object.hasOwn(zips, zip) ? zips[zip] : undefined;
  if (!point) {
    const states = prefixes[zip.slice(0, 3)];
    if (states && !states.includes("MA"))
      throw new SearchInputError(
        "This pilot accepts Massachusetts ZIP codes only.",
      );
    throw new SearchInputError(
      "This ZIP is not recognized in the Massachusetts dataset. Check it or try a nearby ZIP.",
    );
  }
  if (distanceMiles(BOSTON, point) > PILOT_RADIUS_MILES)
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
  let excludedWithoutCoordinates = 0;
  for (const original of records) {
    const provider = { ...original, research: getResearchSummary(original.id) };
    if (evidence === "details" && !provider.research?.detailsAvailable)
      continue;
    if (evidence === "pricing" && !provider.research?.publishedCosts) continue;
    if (
      evidence === "openings" &&
      provider.research?.availabilityStatus !== "opening-published"
    )
      continue;
    if (evidence === "reviews" && provider.research?.experience.value == null)
      continue;
    if (evidence === "unrated" && provider.research?.experience.value != null)
      continue;
    if (
      evidence === "facebook" &&
      !provider.research?.facebookResearch?.findingCount
    )
      continue;
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
    if (
      provider.lat === null ||
      provider.lng === null ||
      !Number.isFinite(provider.lat) ||
      !Number.isFinite(provider.lng)
    ) {
      if (matchesCategory) excludedWithoutCoordinates++;
      continue;
    }
    const distance = distanceMiles(point, {
      lat: provider.lat,
      lng: provider.lng,
    });
    if (distance > radius) continue;
    for (const key of searchableCategories) categories[key]++;
    if (matchesCategory)
      providers.push({ ...provider, distanceMiles: distance });
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
    providers,
    total: providers.length,
    origin: { zip, ...point },
    radius,
    catalogTotal: records.length,
    asOf: meta.asOf,
    categories,
    excludedWithoutCoordinates,
    experienceCoverage: {
      scored: providers.filter((p) => p.research?.experience.value != null)
        .length,
      unscored: providers.filter((p) => p.research?.experience.value == null)
        .length,
      facebookFindings: providers.filter(
        (p) => (p.research?.facebookResearch?.findingCount ?? 0) > 0,
      ).length,
      facebookCovered: providers.filter((p) =>
        Boolean(p.research?.facebookResearch),
      ).length,
    },
  };
}
export function getProvidersByIds(ids: readonly string[]): Provider[] {
  return [...new Set(ids)].flatMap((id) => {
    const provider = byId.get(id);
    return provider
      ? [{ ...provider, research: getResearchSummary(provider.id) }]
      : [];
  });
}
export function getProviderById(id: string): Provider | undefined {
  const provider = byId.get(id);
  return provider
    ? { ...provider, research: getResearchSummary(provider.id) }
    : undefined;
}
