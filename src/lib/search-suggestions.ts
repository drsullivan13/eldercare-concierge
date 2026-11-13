import { distanceMiles } from "./distance";
import { markets, type MarketRegistry } from "./markets";
import { resolveSearchScope, SearchInputError } from "./search-scope";
import type {
  SearchSuggestion,
  SearchSuggestionsResponse,
} from "./search-suggestion-types";

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
  type Match = SearchSuggestion & { distance: number };
  const towns = new Map<string, Match>();
  for (const location of Object.values(market.zips)) {
    const key = location.city.toLocaleLowerCase("en-US");
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
    });
  }
  const providers: Match[] = [];
  for (const provider of market.providers) {
    if (
      provider.state !== market.state ||
      !`${provider.name} ${provider.city}`
        .toLocaleLowerCase("en-US")
        .includes(query) ||
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
    });
  }
  const compare = (a: Match, b: Match) =>
    Number(!a.value.toLocaleLowerCase("en-US").startsWith(query)) -
      Number(!b.value.toLocaleLowerCase("en-US").startsWith(query)) ||
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
