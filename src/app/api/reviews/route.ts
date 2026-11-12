import {
  getLocationResearch,
  ResearchInputError,
} from "@/lib/location-research";
import { getReviewCatalog } from "@/lib/review-catalog";
import { individualReviews } from "@/lib/individual-reviews";

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has("id"))
      throw new ResearchInputError("Supply one provider ID using id.");
    const id = params.get("id")!;
    const research = getLocationResearch(id);
    return Response.json(individualReviews(research, getReviewCatalog(id)), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    if (error instanceof ResearchInputError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
