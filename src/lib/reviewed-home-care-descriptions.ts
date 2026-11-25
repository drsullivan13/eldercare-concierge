import reviewedData from "@/data/reviewed-home-care-descriptions.json";
import snapshotData from "@/data/location-descriptions.json";
import {
  isLocationDescriptionResponse,
  type LocationDescriptionResponse,
} from "./location-description-types";
import type { Provider } from "./providers";

const reviewed: Record<string, unknown> = reviewedData;
const previous: Record<string, { scope: string }> = snapshotData.locations;

export function reviewedHomeCareDescription(
  provider: Provider,
): LocationDescriptionResponse | null {
  if (!Object.hasOwn(reviewed, provider.id)) return null;
  const record = reviewed[provider.id] as {
    text?: unknown;
    source?: unknown;
    checkedAt?: unknown;
  } | null;
  const serviceArea =
    previous[provider.id]?.scope === "service-area" ||
    /\bP\.?\s*O\.?\s*BOX\b|\bPOST OFFICE BOX\b/i.test(provider.address);
  const description: unknown = {
    schemaVersion: 1,
    marketId: "north-jersey",
    providerId: provider.id,
    summary: record?.text,
    checkedAt: record?.checkedAt,
    scope: serviceArea ? "service-area" : "agency-office",
    basis: "provider",
    sources: [
      {
        url: record?.source,
        publisher: provider.name,
        title: "Reviewed home-care description",
        checkedAt: record?.checkedAt,
      },
    ],
    limitations: serviceArea
      ? [
          "Service-area scope does not establish geographic coverage or a physical care site. A mailing address is not a visit location.",
        ]
      : [],
  };
  if (!isLocationDescriptionResponse(description, provider.id))
    throw new Error("Invalid reviewed home-care description.");
  return description;
}
