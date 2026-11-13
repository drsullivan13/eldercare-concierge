import { SearchInputError } from "@/lib/search-scope";
import { searchSuggestions } from "@/lib/search-suggestions";

export function GET(request: Request) {
  try {
    return Response.json(searchSuggestions(new URL(request.url).searchParams));
  } catch (error) {
    if (error instanceof SearchInputError)
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
