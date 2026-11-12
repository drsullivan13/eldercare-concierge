import { getProviderMarket, markets, type MarketRegistry } from "./markets";

export type FacebookFindingKind =
  | "resident-family"
  | "recommendation"
  | "tour"
  | "provider-promotion"
  | "employment";

type FacebookFinding = {
  id: string;
  sourceObservationIds: string[];
  kind: FacebookFindingKind;
  relationship: string | null;
  summary: string;
  date: string | null;
  sourceUrl: string;
  sourceUrls?: string[];
  threadUrl: string;
  topics: string[];
  limitations: string[];
};

type FacebookResearchLocation = {
  status: "findings-available" | "no-relevant-result" | "withheld" | "partial";
  searchedAt: string | null;
  foundCount: number;
  publishedObservationCount: number;
  withheldCount: number;
  coverageExplanation: string;
  findings: FacebookFinding[];
};

export type FacebookResearchDataset = {
  schemaVersion: 1;
  runId: string;
  checkedAt: string;
  reviewBasis: string;
  locations: Record<string, FacebookResearchLocation>;
};

export type FacebookResearch = FacebookResearchLocation & {
  providerId: string;
  runId: string;
  checkedAt: string;
  reviewBasis: string;
};

export type FacebookSummary = Pick<
  FacebookResearchLocation,
  | "status"
  | "searchedAt"
  | "foundCount"
  | "publishedObservationCount"
  | "withheldCount"
> & { findingCount: number };

export type FamilyExperience = {
  distinctThreadCount: number;
  scope: "exact-provider";
  selectionCaveat: string;
};

function originalThreadIdentity(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      ![
        "facebook.com",
        "www.facebook.com",
        "m.facebook.com",
        "mbasic.facebook.com",
        "web.facebook.com",
      ].includes(url.hostname)
    )
      return undefined;
    const path = url.pathname.replace(/\/+$/, "");
    const group = path.match(
      /^\/groups\/([A-Za-z0-9._-]+)\/(?:posts|permalink)\/([A-Za-z0-9]+)$/,
    );
    if (group) return `group/${group[1]}/${group[2]}`;
    const post = path.match(/^\/([A-Za-z0-9._-]+)\/posts\/([A-Za-z0-9]+)$/);
    if (post) return `post/${post[1]}/${post[2]}`;
    if (path === "/permalink.php" || path === "/story.php") {
      const owners = url.searchParams.getAll("id");
      const posts = url.searchParams.getAll("story_fbid");
      if (
        owners.length === 1 &&
        posts.length === 1 &&
        /^[A-Za-z0-9._-]+$/.test(owners[0]) &&
        /^[A-Za-z0-9]+$/.test(posts[0])
      )
        return `post/${owners[0]}/${posts[0]}`;
    }
    const video = path.match(/^\/(?:reel|watch\/videos)\/([A-Za-z0-9]+)$/);
    if (video) return `video/${video[1]}`;
  } catch {
    return undefined;
  }
  return undefined;
}

export function getFamilyExperience(
  providerId: string,
  registry: MarketRegistry = markets,
): FamilyExperience | undefined {
  const research = getFacebookResearch(providerId, registry);
  if (!research) return undefined;
  const threads = new Set<string>();
  for (const finding of research.findings) {
    if (finding.kind !== "resident-family") continue;
    const identity = originalThreadIdentity(finding.threadUrl);
    if (identity) threads.add(identity);
  }
  return {
    distinctThreadCount: threads.size,
    scope: "exact-provider",
    selectionCaveat:
      "Selected editorially released resident or family accounts for this exact provider, not a representative survey. Thread counts do not measure people, positivity, quality or prevalence. Relationships are not independently authenticated.",
  };
}

// This curated snapshot is separate from review aggregates and the score policy.
// An absent location means not searched in this pilot, never "no Facebook reviews".
export function getFacebookResearch(
  providerId: string,
  registry: MarketRegistry = markets,
): FacebookResearch | undefined {
  const dataset = getProviderMarket(providerId, registry)?.facebookResearch;
  if (!dataset || !Object.hasOwn(dataset.locations, providerId))
    return undefined;
  const location = dataset.locations[providerId];
  return {
    providerId,
    runId: dataset.runId,
    checkedAt: dataset.checkedAt,
    reviewBasis: dataset.reviewBasis,
    status: location.status,
    searchedAt: location.searchedAt,
    foundCount: location.foundCount,
    publishedObservationCount: location.publishedObservationCount,
    withheldCount: location.withheldCount,
    coverageExplanation: location.coverageExplanation,
    findings: location.findings,
  };
}

export function getFacebookSummary(
  providerId: string,
  registry: MarketRegistry = markets,
): FacebookSummary | undefined {
  const research = getFacebookResearch(providerId, registry);
  if (!research) return undefined;
  const {
    status,
    searchedAt,
    foundCount,
    publishedObservationCount,
    withheldCount,
  } = research;
  return {
    status,
    searchedAt,
    foundCount,
    publishedObservationCount,
    withheldCount,
    findingCount: research.findings.length,
  };
}
