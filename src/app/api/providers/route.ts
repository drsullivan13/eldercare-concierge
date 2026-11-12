import { registeredMarket } from "@/lib/market-registration";
import { getProvidersByIds } from "@/lib/search";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("ids");
  const market = params.get("market") ?? undefined;
  if (
    raw === null ||
    params.getAll("ids").length !== 1 ||
    params.getAll("market").length > 1 ||
    [...params.keys()].some((key) => !["ids", "market"].includes(key)) ||
    (market !== undefined && !registeredMarket(market))
  )
    return Response.json(
      { error: "Supply one ids parameter and at most one supported market." },
      { status: 400 },
    );
  if (!raw.trim()) return Response.json({ providers: [] });
  const ids = raw.split(",").map((id) => id.trim());
  if (ids.length > 100 || ids.some((id) => !id || id.length > 200))
    return Response.json(
      { error: "Supply 1 to 100 nonempty provider IDs." },
      { status: 400 },
    );
  return Response.json({ providers: getProvidersByIds(ids, market) });
}
