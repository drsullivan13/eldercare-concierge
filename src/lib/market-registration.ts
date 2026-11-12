import registrationData from "../data/market-registrations.json";
import type { Market } from "./market-types";

export type MarketRegistration = Market & {
  defaultZip: string;
  stateLabel: string;
};

export function parseMarketRegistrations(value: unknown): MarketRegistration[] {
  if (!Array.isArray(value)) throw new Error("Invalid market registrations.");
  const ids = new Set<string>();
  const defaults = new Set<string>();
  for (const r of value) {
    if (
      !r ||
      typeof r !== "object" ||
      typeof r.id !== "string" ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(r.id) ||
      ids.has(r.id) ||
      typeof r.state !== "string" ||
      !/^[A-Z]{2}$/.test(r.state) ||
      typeof r.label !== "string" ||
      !r.label.trim() ||
      typeof r.stateLabel !== "string" ||
      !r.stateLabel.trim() ||
      typeof r.defaultZip !== "string" ||
      !/^\d{5}$/.test(r.defaultZip) ||
      defaults.has(r.defaultZip)
    )
      throw new Error("Invalid or duplicate market registration.");
    ids.add(r.id);
    defaults.add(r.defaultZip);
  }
  if (!ids.has("massachusetts"))
    throw new Error("Missing legacy market registration.");
  return value;
}

export const marketRegistrations = parseMarketRegistrations(registrationData);
export const legacyMarket = marketRegistrations.find(
  (r) => r.id === "massachusetts",
)!;

export function registeredMarket(
  id: unknown,
  registrations = marketRegistrations,
) {
  return registrations.find((market) => market.id === id);
}

export function matchesProviderNamespace(id: string, marketId: string) {
  return (
    marketId === legacyMarket.id ||
    /^cms-\d{6}$/.test(id) ||
    id.startsWith(marketId + "-")
  );
}
