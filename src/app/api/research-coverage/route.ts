import {
  getResearchCoverage,
  researchCoverageCsv,
} from "@/lib/research-coverage";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some((key) => key !== "format") ||
    params.getAll("format").length > 1 ||
    (params.has("format") && !["json", "csv"].includes(params.get("format")!))
  ) {
    return Response.json(
      { error: "Choose format=json or format=csv." },
      { status: 400 },
    );
  }
  const coverage = getResearchCoverage();
  if (params.get("format") === "csv") {
    return new Response(researchCoverageCsv(coverage), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="harbor-experience-research-${coverage.asOfDate}.csv"`,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return Response.json(coverage, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
