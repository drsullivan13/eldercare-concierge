import { getLocationResearch } from "@/lib/location-research";
import {
  getLocationFeedback,
  getExternalReviewProfiles,
  getReviewCatalog,
} from "@/lib/review-catalog";
import { individualReviews } from "@/lib/individual-reviews";
import { publicResearchNotes } from "@/lib/public-location-research";
import { researchResponse } from "../research-response";

export function GET(request: Request) {
  return researchResponse(request, (id) => {
    const research = getLocationResearch(id);
    const reviews = individualReviews(research, getReviewCatalog(id));
    const externalProfiles = getExternalReviewProfiles(id);
    return {
      providerId: reviews.providerId,
      ...getLocationFeedback(id),
      ...(externalProfiles.length ? { externalProfiles } : {}),
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
          source.scopeNote && publicResearchNotes([source.scopeNote]).join(" "),
      })),
      notes: publicResearchNotes(reviews.notes),
    };
  });
}
