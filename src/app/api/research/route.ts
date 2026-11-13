import {
  getLocationResearch,
  ResearchInputError,
} from "@/lib/location-research";
import { publicLocationResearch } from "@/lib/public-location-research";
export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has("id"))
      throw new ResearchInputError("Supply one provider ID using id.");
    return Response.json(
      publicLocationResearch(getLocationResearch(params.get("id")!)),
      {
        headers: { "Cache-Control": "public, max-age=300" },
      },
    );
  } catch (error) {
    if (error instanceof ResearchInputError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
