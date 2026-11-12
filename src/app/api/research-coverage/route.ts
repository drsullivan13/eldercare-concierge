import {
  getResearchCoverage,
  researchCoverageCsv,
  ResearchCoverageInputError,
} from "@/lib/research-coverage";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some((key) => !["format", "market"].includes(key)) ||
    params.getAll("market").length > 1 ||
    (params.has("market") &&
      !["massachusetts", "north-jersey"].includes(params.get("market")!)) ||
    params.getAll("format").length > 1 ||
    (params.has("format") && !["json", "csv"].includes(params.get("format")!))
  ) {
    return Response.json(
      { error: "Choose one supported market and format=json or format=csv." },
      { status: 400 },
    );
  }
  let coverage;
  try {
    coverage = getResearchCoverage(
      undefined,
      params.get("market") ?? undefined,
    );
  } catch (error) {
    if (error instanceof ResearchCoverageInputError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (params.get("format") === "csv") {
    return new Response(researchCoverageCsv(coverage), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="harbor-experience-research-${coverage.market.id}-${coverage.asOfDate}.csv"`,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return Response.json(coverage, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
