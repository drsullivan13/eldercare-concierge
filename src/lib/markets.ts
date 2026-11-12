import providerData from "@/data/providers.json";
import zipData from "@/data/ma-zips.json";
import meta from "@/data/catalog-meta.json";
import locationResearch from "@/data/location-research.json";
import facebookResearch from "@/data/facebook-research.json";
import inspectionHistory from "@/data/inspection-history.json";
import homeHealthEvidence from "@/data/home-health-evidence.json";
import regionalMarkets from "@/data/regional-markets.json";
import type { Provider } from "./providers";
import type { LocationResearch } from "./location-research-types";
import type { FacebookResearchDataset } from "./facebook-research";
import type { InspectionHistorySnapshot } from "./inspections";
import type { HomeHealthEvidenceSnapshot } from "./home-health";
import type { Market } from "./market-types";

export type MarketSnapshot = Market & {
  defaultZip: string;
  zips: Record<string, { city: string; lat: number; lng: number }>;
  meta: { asOf: string; [key: string]: unknown };
  providers: Provider[];
  locationResearch?: Record<string, LocationResearch>;
  facebookResearch?: FacebookResearchDataset;
  inspectionHistory?: InspectionHistorySnapshot;
  homeHealthEvidence?: HomeHealthEvidenceSnapshot;
};
export type MarketRegistry = readonly MarketSnapshot[];

export const BOSTON = { lat: 42.3601, lng: -71.0589 };
export const MASSACHUSETTS_ORIGIN_RADIUS_MILES = 55;

export function createMarketRegistry(
  snapshots: MarketRegistry,
): MarketRegistry {
  const ids = new Set<string>();
  const providerIds = new Set<string>();
  const ccns = new Set<string>();
  const zips = new Set<string>();
  for (const market of snapshots) {
    if (
      !(
        (market.id === "massachusetts" && market.state === "MA") ||
        (market.id === "north-jersey" && market.state === "NJ")
      ) ||
      ids.has(market.id) ||
      !market.label ||
      !market.meta?.asOf ||
      !Array.isArray(market.providers) ||
      !market.zips ||
      !Object.hasOwn(market.zips, market.defaultZip)
    )
      throw new Error("Invalid or duplicate reviewed market snapshot.");
    ids.add(market.id);
    for (const [zip, point] of Object.entries(market.zips)) {
      if (
        !/^\d{5}$/.test(zip) ||
        zips.has(zip) ||
        !point.city ||
        !Number.isFinite(point.lat) ||
        Math.abs(point.lat) > 90 ||
        !Number.isFinite(point.lng) ||
        Math.abs(point.lng) > 180
      )
        throw new Error("Invalid or ambiguous reviewed market ZIP.");
      zips.add(zip);
    }
    for (const provider of market.providers) {
      if (provider.state !== market.state) continue;
      if (providerIds.has(provider.id))
        throw new Error("Provider IDs must be globally unique across markets.");
      providerIds.add(provider.id);
      if (provider.cms) {
        if (
          provider.id !== `cms-${provider.cms.ccn}` ||
          ccns.has(provider.cms.ccn)
        )
          throw new Error(
            "CMS IDs must retain their globally unique CCN identity.",
          );
        ccns.add(provider.cms.ccn);
      }
    }
  }
  return snapshots;
}

if (!Array.isArray(regionalMarkets))
  throw new Error(
    "regional-markets.json must contain an array of reviewed snapshots.",
  );

export const markets = createMarketRegistry([
  {
    id: "massachusetts",
    label: "Massachusetts",
    state: "MA",
    defaultZip: "02459",
    zips: zipData,
    meta,
    providers: providerData as Provider[],
    locationResearch: locationResearch as Record<string, LocationResearch>,
    facebookResearch: facebookResearch as unknown as FacebookResearchDataset,
    inspectionHistory:
      inspectionHistory as unknown as InspectionHistorySnapshot,
    homeHealthEvidence: homeHealthEvidence as HomeHealthEvidenceSnapshot,
  },
  ...(regionalMarkets as unknown as MarketSnapshot[]),
]);

export function getMarket(id = "massachusetts", registry = markets) {
  return registry.find((market) => market.id === id);
}

export function getProviderMarket(providerId: string, registry = markets) {
  return registry.find((market) =>
    market.providers.some(
      (provider) =>
        provider.id === providerId && provider.state === market.state,
    ),
  );
}

export function marketIdentity({ id, label, state }: Market): Market {
  return { id, label, state };
}
