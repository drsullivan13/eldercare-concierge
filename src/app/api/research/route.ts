import { getLocationResearch } from "@/lib/location-research";
import { publicLocationResearch } from "@/lib/public-location-research";
import { researchResponse } from "../research-response";

export function GET(request: Request) {
  return researchResponse(request, (id) =>
    publicLocationResearch(getLocationResearch(id)),
  );
}
