import {
  getHomeHealthEvidence,
  HomeHealthEvidenceError,
} from "@/lib/home-health";

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has("providerId")) {
      throw new HomeHealthEvidenceError(
        "Supply exactly one catalog providerId and no CCN or other selectors.",
      );
    }
    return Response.json(getHomeHealthEvidence(params.get("providerId")!), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof HomeHealthEvidenceError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
