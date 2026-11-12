import { SearchInputError, searchProviders } from "@/lib/search";

export function GET(request: Request) {
  try {
    return Response.json(searchProviders(new URL(request.url).searchParams));
  } catch (error) {
    if (error instanceof SearchInputError)
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
