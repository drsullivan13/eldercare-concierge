export type SearchSuggestion = {
  id: string;
  kind: "town" | "provider";
  value: string;
  detail: string;
};

export type SearchSuggestionsResponse = {
  suggestions: SearchSuggestion[];
};
