import snapshotData from "@/data/location-descriptions.json";
import { getProviderEntry } from "./markets";
import {
  isLocationDescriptionResponse,
  type LocationDescriptionResponse,
} from "./location-description-types";

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
  const entry = getProviderEntry(providerId);
  if (entry?.market.id !== "north-jersey")
    throw new LocationDescriptionInputError(
      "No North Jersey catalog provider matches this ID.",
      404,
    );

  if (entry.provider.category === "home-care")
    return entry.provider.locationDescription ?? null;

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
  if (Object.hasOwn(snapshot.locations, providerId)) {
    const description: unknown = {
      ...(snapshot.locations[providerId] as Record<string, unknown>),
      schemaVersion: snapshot.schemaVersion,
      marketId: snapshot.marketId,
      checkedAt: snapshot.checkedAt,
    };
    if (!isLocationDescriptionResponse(description, providerId))
      throw new Error("Invalid location description record.");
    return description;
  }
  return null;
}
