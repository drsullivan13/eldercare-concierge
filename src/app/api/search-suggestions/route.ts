import { SearchInputError } from "@/lib/search-scope";
import { searchSuggestions } from "@/lib/search-suggestions";

const headers = { "Cache-Control": "private, no-store" };

export function GET(request: Request) {
  try {
    return Response.json(searchSuggestions(new URL(request.url).searchParams), {
      headers,
    });
  } catch (error) {
    if (error instanceof SearchInputError)
      return Response.json({ error: error.message }, { status: 400, headers });
    throw error;
  }
}
