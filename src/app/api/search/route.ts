import { SearchInputError, searchProviders } from "@/lib/search";

const privateCache = "private, no-store";

function cacheableSearch({ search, searchParams }: URL) {
  const zip = searchParams.get("zip");
  const radius = searchParams.get("radius");
  // Validated filters have finite choices. Limit equivalent URL spellings too.
  return (
    !searchParams.get("q") &&
    search.slice(1) === searchParams.toString() &&
    (zip === null || /^\d{5}$/.test(zip)) &&
    (radius === null || /^[1-9]\d?$/.test(radius))
  );
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const nextUtcMidnight = new Date();
  nextUtcMidnight.setUTCHours(24, 0, 0, 0);
  try {
    const response = Response.json(searchProviders(url.searchParams));
    const ttl = Math.min(
      300,
      Math.floor((nextUtcMidnight.getTime() - Date.now()) / 1000),
    );
    response.headers.set(
      "Cache-Control",
      ttl > 0 && cacheableSearch(url)
        ? `public, max-age=0, s-maxage=${ttl}, must-revalidate`
        : privateCache,
    );
    return response;
  } catch (error) {
    if (error instanceof SearchInputError)
      return Response.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": privateCache } },
      );
    throw error;
  }
}
