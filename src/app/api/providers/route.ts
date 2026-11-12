import { getProvidersByIds } from "@/lib/search";

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids");
  if (raw === null)
    return Response.json(
      {
        error:
          "Supply a comma-separated ids query parameter (maximum 100 IDs).",
      },
      { status: 400 },
    );
  if (!raw.trim()) return Response.json({ providers: [] });
  const ids = raw.split(",").map((id) => id.trim());
  if (ids.length > 100 || ids.some((id) => !id || id.length > 200))
    return Response.json(
      { error: "Supply 1 to 100 nonempty provider IDs." },
      { status: 400 },
    );
  return Response.json({ providers: getProvidersByIds(ids) });
}
