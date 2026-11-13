import type {
  InternalLocationResearchResponse,
  LocationResearchResponse,
} from "./location-research-types";
import { publicExperience } from "./public-experience";

function publicResearchSentence(sentence: string): string {
  const clauses = sentence.split(/;\s*/);
  const publicClauses = clauses
    .map((clause) =>
      clause
        .replace(
          /^Do not score:\s*(.)/i,
          (_match, initial: string) =>
            `Location identity needs confirmation. ${initial.toUpperCase()}`,
        )
        .replace(
          /\bnursing-only score scope\b/i,
          "nursing-only review population",
        )
        .replace(
          /,\s*so (?:this remains ambiguous and excluded from score coverage|no score eligible evidence)\.?$/i,
          ".",
        )
        .replace(/\s+and not full-page eligible\.?$/i, ".")
        .replace(
          /\ban eligible direct consumer aggregate\b/i,
          "a direct consumer aggregate",
        ),
    )
    .filter((clause) => {
      if (
        /\b(threshold|weight(?:ed|ing|s)?|source.family|deduplic\w*|full-page eligible|CMS stars ignored|double-count|syndication credit)\b/i.test(
          clause,
        )
      )
        return false;
      if (/\bproprietary\b/i.test(clause)) return true;
      if (
        /\b(?:not (?:a |an )?(?:clinical|care-level|unit-specific)|no CMS nursing-home score applies)\b/i.test(
          clause,
        )
      )
        return true;
      return !/\b(score[sd]?|scoring|experience.index|numeric.index)\b/i.test(
        clause,
      );
    });
  if (
    publicClauses.length === clauses.length &&
    publicClauses.every((clause, index) => clause === clauses[index])
  )
    return sentence;
  const context = publicClauses.join("; ");
  return !context || /[.!?]$/.test(context) ? context : `${context}.`;
}

export function publicResearchNotes(notes: readonly string[]): string[] {
  return notes.flatMap((note) => {
    const context = note
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map(publicResearchSentence)
      .filter(Boolean)
      .join(" ");
    return context ? [context] : [];
  });
}

export function publicLocationResearch(
  data: InternalLocationResearchResponse,
): LocationResearchResponse {
  const facebook = data.facebookResearch;
  return {
    providerId: data.providerId,
    checkedAt: data.checkedAt,
    providerDetailsReviewed: data.providerDetailsReviewed,
    sources: data.sources.map((source) => ({
      id: source.id,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      kind: source.kind,
      checkedAt: source.checkedAt,
      publishedAt: source.publishedAt,
      access: source.access,
      ...(source.excerpt && {
        excerpt: publicResearchNotes([source.excerpt]).join(" "),
      }),
    })),
    facts: data.facts,
    availability: data.availability,
    reviewAggregates: data.reviewAggregates.map((aggregate) => ({
      sourceId: aggregate.sourceId,
      platform: aggregate.platform,
      rating: aggregate.rating,
      scale: aggregate.scale,
      count: aggregate.count,
      asOf: aggregate.asOf,
      scope: aggregate.scope,
      notes: publicResearchNotes(aggregate.notes),
    })),
    reviews: data.reviews.map((review) => ({
      id: review.id,
      sourceId: review.sourceId,
      url: review.url,
      date: review.date,
      rating: review.rating,
      scale: review.scale,
      relationship: review.relationship,
      excerpt: review.excerpt,
      summary: review.summary,
      aspects: review.aspects,
      notes: publicResearchNotes(review.notes),
    })),
    reviewLinks: data.reviewLinks,
    notes: publicResearchNotes(data.notes),
    admissionRestriction: data.admissionRestriction,
    dailyLife: data.dailyLife,
    nursingStaffing: data.nursingStaffing,
    familyExperience: data.familyExperience,
    facebookResearch: facebook && {
      providerId: facebook.providerId,
      status: facebook.status,
      searchedAt: facebook.searchedAt,
      foundCount: facebook.foundCount,
      publishedObservationCount: facebook.publishedObservationCount,
      withheldCount: facebook.withheldCount,
      runId: facebook.runId,
      checkedAt: facebook.checkedAt,
      reviewBasis: publicResearchNotes([facebook.reviewBasis]).join(" "),
      coverageExplanation: publicResearchNotes([
        facebook.coverageExplanation,
      ]).join(" "),
      findings: facebook.findings.map((finding) => ({
        id: finding.id,
        sourceObservationIds: finding.sourceObservationIds,
        kind: finding.kind,
        relationship: finding.relationship,
        summary: finding.summary,
        excerpt: finding.excerpt,
        date: finding.date,
        sourceUrl: finding.sourceUrl,
        sourceUrls: finding.sourceUrls,
        threadUrl: finding.threadUrl,
        topics: finding.topics,
        limitations: publicResearchNotes(finding.limitations),
      })),
    },
    experience: publicExperience(data.experience),
  };
}
