import { distanceMiles } from "./distance";
import { markets, type MarketRegistry, type MarketSnapshot } from "./markets";
import { resolveSearchScope, SearchInputError } from "./search-scope";
import type {
  SearchSuggestion,
  SearchSuggestionsResponse,
} from "./search-suggestion-types";

function indexMarket(market: MarketSnapshot) {
  return {
    towns: Object.values(market.zips).map((location) => ({
      location,
      key: location.city.toLocaleLowerCase("en-US"),
    })),
    providers: market.providers.map((provider) => ({
      provider,
      name: provider.name.toLocaleLowerCase("en-US"),
      matchText: `${provider.name} ${provider.city}`.toLocaleLowerCase("en-US"),
    })),
  };
}

const publishedIndexes = new Map<
  MarketSnapshot,
  ReturnType<typeof indexMarket>
>();

export function searchSuggestions(
  input: URLSearchParams,
  registry: MarketRegistry = markets,
): SearchSuggestionsResponse {
  const allowed = ["zip", "radius", "category", "q"];
  if (
    [...input.keys()].some(
      (key) => !allowed.includes(key) || input.getAll(key).length !== 1,
    )
  )
    throw new SearchInputError(
      "Supply each supported suggestion parameter at most once.",
    );
  const query = (input.get("q") ?? "").trim().toLocaleLowerCase("en-US");
  if (query.length > 200)
    throw new SearchInputError("Search text must be 200 characters or fewer.");
  const { market, point, radius, category } = resolveSearchScope(
    Object.fromEntries(input),
    registry,
  );
  if (query.length < 2) return { suggestions: [] };
  let index = registry === markets ? publishedIndexes.get(market) : undefined;
  if (!index) {
    index = indexMarket(market);
    if (registry === markets) publishedIndexes.set(market, index);
  }
  type Match = SearchSuggestion & {
    distance: number;
    normalizedValue: string;
  };
  const towns = new Map<string, Match>();
  for (const { location, key } of index.towns) {
    if (!key.includes(query)) continue;
    const distance = distanceMiles(point, location);
    if (distance > radius || (towns.get(key)?.distance ?? Infinity) <= distance)
      continue;
    towns.set(key, {
      id: `town:${market.id}:${key}`,
      kind: "town",
      value: location.city,
      detail: `Town · ${market.state}`,
      distance,
      normalizedValue: key,
    });
  }
  const providers: Match[] = [];
  for (const { provider, name, matchText } of index.providers) {
    if (
      provider.state !== market.state ||
      !matchText.includes(query) ||
      (category !== "all" &&
        provider.category !== category &&
        !provider.searchCategories?.includes(category)) ||
      provider.lat === null ||
      provider.lng === null ||
      !Number.isFinite(provider.lat) ||
      !Number.isFinite(provider.lng)
    )
      continue;
    const distance = distanceMiles(point, {
      lat: provider.lat,
      lng: provider.lng,
    });
    if (distance > radius) continue;
    providers.push({
      id: provider.id,
      kind: "provider",
      value: provider.name,
      detail: `${provider.city}, ${provider.state} · Provider`,
      distance,
      normalizedValue: name,
    });
  }
  const compare = (a: Match, b: Match) =>
    Number(!a.normalizedValue.startsWith(query)) -
      Number(!b.normalizedValue.startsWith(query)) ||
    a.distance - b.distance ||
    a.value.localeCompare(b.value, "en", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id, "en");
  const townMatches = [...towns.values()].sort(compare).slice(0, 4);
  const providerMatches = providers
    .sort(compare)
    .slice(0, 10 - townMatches.length);
  return {
    suggestions: [...townMatches, ...providerMatches].map(
      ({ id, kind, value, detail }) => ({ id, kind, value, detail }),
    ),
  };
}
