import snapshotData from "@/data/location-descriptions.json";
import upgradeData from "../../research/north-jersey/supplemental-release/first-party-upgrades.json";
import { getProviderMarket } from "./markets";
import {
  isLocationDescriptionResponse,
  type LocationDescriptionResponse,
} from "./location-description-types";

type OfficeUpgrade = {
  providerId: string;
  identity: Record<
    "name" | "category" | "address" | "city" | "state" | "zip",
    string
  >;
  checkedAt: string;
  scope: string;
  statement: { text: string; source_urls: string[] };
  sourceUrls: string[];
  limitations: string[];
};

const officeUpgrades: Record<string, OfficeUpgrade> = upgradeData;

export class LocationDescriptionInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}

export async function getLocationDescription(
  providerId: string,
): Promise<LocationDescriptionResponse | null> {
  if (providerId.length > 150 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId))
    throw new LocationDescriptionInputError("Supply one exact provider ID.");
  const market = getProviderMarket(providerId);
  if (market?.id !== "north-jersey")
    throw new LocationDescriptionInputError(
      "No North Jersey catalog provider matches this ID.",
      404,
    );

  const snapshot: {
    schemaVersion: number;
    marketId: string;
    checkedAt: string;
    locations: Record<string, unknown>;
  } = snapshotData;
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot.marketId !== "north-jersey" ||
    !snapshot.locations ||
    typeof snapshot.locations !== "object" ||
    Array.isArray(snapshot.locations)
  )
    throw new Error("Invalid location description snapshot.");
  let existing: LocationDescriptionResponse | null = null;
  if (Object.hasOwn(snapshot.locations, providerId)) {
    const description: unknown = {
      ...(snapshot.locations[providerId] as Record<string, unknown>),
      schemaVersion: snapshot.schemaVersion,
      marketId: snapshot.marketId,
      checkedAt: snapshot.checkedAt,
    };
    if (!isLocationDescriptionResponse(description, providerId))
      throw new Error("Invalid location description record.");
    existing = description;
  }
  if (
    existing?.basis === "provider" ||
    !Object.hasOwn(officeUpgrades, providerId)
  )
    return existing;

  const upgrade = officeUpgrades[providerId];
  const provider = market.providers.find(({ id }) => id === providerId)!;
  if (
    upgrade.providerId !== providerId ||
    provider.category !== "home-care" ||
    !(["name", "category", "address", "city", "state", "zip"] as const).every(
      (field) => upgrade.identity[field] === provider[field],
    )
  )
    throw new Error("Invalid first-party office identity.");
  if (
    upgrade.scope !==
      "Exact local office. No catalog address, service-area or licensing override." ||
    upgrade.statement.text.trim().length < 25 ||
    upgrade.statement.text.length > 700 ||
    /\n/.test(upgrade.statement.text) ||
    !upgrade.statement.source_urls.length ||
    !upgrade.statement.source_urls.every((url) =>
      upgrade.sourceUrls.includes(url),
    )
  )
    throw new Error("Invalid first-party office description.");

  const serviceArea =
    existing?.scope === "service-area" ||
    /^\s*(?:P\.?\s*O\.?\s*BOX\b|POST OFFICE BOX\b)/i.test(provider.address);
  const description: unknown = {
    schemaVersion: 1,
    marketId: "north-jersey",
    checkedAt: upgrade.checkedAt,
    providerId,
    summary: upgrade.statement.text,
    basis: "provider",
    scope: serviceArea ? "service-area" : "agency-office",
    sources: upgrade.sourceUrls.map((url) => ({
      url,
      publisher: upgrade.identity.name,
      title: "Official office services and identity",
      checkedAt: upgrade.checkedAt,
    })),
    limitations: [
      ...upgrade.limitations,
      ...(serviceArea
        ? [
            "Service-area scope does not establish geographic coverage or a physical care site. A mailing address is not a visit location.",
          ]
        : []),
    ],
  };
  if (!isLocationDescriptionResponse(description, providerId))
    throw new Error("Invalid first-party office description record.");
  return description;
}
