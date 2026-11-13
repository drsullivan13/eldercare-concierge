import {
  getLocationDescription,
  LocationDescriptionInputError,
} from "@/lib/location-descriptions";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has("id"))
      throw new LocationDescriptionInputError(
        "Supply one provider ID using id.",
      );
    const description = await getLocationDescription(params.get("id")!);
    if (!description)
      return Response.json(
        { error: "No description is published for this provider." },
        { status: 404 },
      );
    return Response.json(description, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    if (error instanceof LocationDescriptionInputError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
