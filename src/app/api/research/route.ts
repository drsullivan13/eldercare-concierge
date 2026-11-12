import {
  getLocationResearch,
  ResearchInputError,
} from "@/lib/location-research";
export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (
      params.getAll("id").length !== 1 ||
      [...params.keys()].some((k) => k !== "id")
    )
      throw new ResearchInputError("Supply one provider ID using id.");
    return Response.json(getLocationResearch(params.get("id")!), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    if (error instanceof ResearchInputError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
