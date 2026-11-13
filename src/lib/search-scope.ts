import prefixData from "@/data/us-zip-prefix-states.json";
import { distanceMiles } from "./distance";
import { legacyMarket, marketRegistrations } from "./market-registration";
import {
  BOSTON,
  MASSACHUSETTS_ORIGIN_RADIUS_MILES,
  getMarket,
  markets,
  type MarketRegistry,
} from "./markets";
import { CATEGORY_LABELS, type CareCategory } from "./providers";

export class SearchInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}

export function resolveSearchScope(
  opts: { zip?: string; radius?: string | number; category?: string },
  registry: MarketRegistry = markets,
) {
  const zip =
    opts.zip === undefined ? legacyMarket.defaultZip : opts.zip.trim();
  if (!/^\d{5}$/.test(zip))
    throw new SearchInputError(
      "Enter a five-digit ZIP code, including its leading zero.",
    );
  const market = registry.find((entry) => Object.hasOwn(entry.zips, zip));
  if (!market) {
    const states = (prefixData as Record<string, string[]>)[zip.slice(0, 3)];
    const regional = marketRegistrations.find(
      (r) => r.id !== legacyMarket.id && states?.includes(r.state),
    );
    if (regional)
      throw new SearchInputError(
        getMarket(regional.id, registry)
          ? `This ZIP is not recognized in the published ${regional.label} coverage. It may be invalid or outside the covered counties. Check it or try a nearby covered ZIP.`
          : `${regional.label} coverage is pending for this ZIP. No reviewed ZIP and provider snapshot is available for it.`,
      );
    if (states && !states.includes(legacyMarket.state))
      throw new SearchInputError(
        `This ZIP is outside the supported ${new Intl.ListFormat("en-US").format(marketRegistrations.map((r) => r.label))} markets.`,
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
  if (category !== "all" && !Object.hasOwn(CATEGORY_LABELS, category))
    throw new SearchInputError("Choose a supported care category.");
  return {
    zip,
    market,
    point,
    radius,
    category: category as CareCategory | "all",
  };
}
