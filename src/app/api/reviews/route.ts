import {
  getLocationResearch,
  ResearchInputError,
} from "@/lib/location-research";
import { getReviewCatalog } from "@/lib/review-catalog";
import { individualReviews } from "@/lib/individual-reviews";
import { publicResearchNotes } from "@/lib/public-location-research";

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has("id"))
      throw new ResearchInputError("Supply one provider ID using id.");
    const id = params.get("id")!;
    const research = getLocationResearch(id);
    const reviews = individualReviews(research, getReviewCatalog(id));
    return Response.json(
      {
        providerId: reviews.providerId,
        accounts: reviews.accounts.map((account) => ({
          ...account,
          notes: publicResearchNotes(account.notes),
        })),
        sources: reviews.sources.map((source) => ({
          id: source.id,
          publisher: source.publisher,
          url: source.url,
          reportedCount: source.reportedCount,
          retainedCount: source.retainedCount,
          previouslyUnseenCount: source.previouslyUnseenCount,
          pagesChecked: source.pagesChecked,
          coverage: source.coverage,
          stopReason: publicResearchNotes([source.stopReason]).join(" "),
          scopeNote:
            source.scopeNote &&
            publicResearchNotes([source.scopeNote]).join(" "),
        })),
        notes: publicResearchNotes(reviews.notes),
      },
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
