"use client";

import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@ui-sdk/react/autocomplete";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/providers";
import type { SearchSuggestion } from "@/lib/search-suggestion-types";
import type { AutocompleteControlProps } from "./provider-town-autocomplete";
import { providerDisplayName } from "../provider-display-name";
import styles from "./provider-town-autocomplete.module.css";

type Result =
  | { key: string; status: "ready"; suggestions: SearchSuggestion[] }
  | { key: string; status: "error" };

function readSuggestions(body: unknown): SearchSuggestion[] {
  if (
    !body ||
    typeof body !== "object" ||
    !("suggestions" in body) ||
    !Array.isArray(body.suggestions) ||
    body.suggestions.length > 10 ||
    !body.suggestions.every(
      (item: unknown) =>
        item !== null &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string" &&
        "kind" in item &&
        (item.kind === "town" || item.kind === "provider") &&
        "value" in item &&
        typeof item.value === "string" &&
        "detail" in item &&
        typeof item.detail === "string",
    )
  )
    throw new Error("Invalid search suggestions.");
  return body.suggestions;
}

export default function ProviderTownAutocompleteControl({
  value,
  onChange,
  zip,
  radius,
  category,
  id,
  restoreFocus,
  selection,
}: AutocompleteControlProps) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(restoreFocus);
  const [open, setOpen] = useState(restoreFocus);
  const [result, setResult] = useState<Result | null>(null);
  const query = value.trim();
  const eligible =
    query.length >= 2 &&
    query.length <= 200 &&
    /^\d{5}$/.test(zip.trim()) &&
    /^\d+(?:\.\d+)?$/.test(radius.trim()) &&
    Number(radius) >= 1 &&
    Number(radius) <= 50 &&
    (category === "all" || Object.hasOwn(CATEGORY_LABELS, category));
  const key = new URLSearchParams({
    q: query,
    zip,
    radius,
    category,
  }).toString();
  const current = eligible && result?.key === key ? result : null;
  const suggestions = current?.status === "ready" ? current.suggestions : [];
  const status =
    current?.status === "error" ? "error" : current ? "idle" : "loading";

  useLayoutEffect(() => {
    if (!restoreFocus) return;
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(selection[0], selection[1]);
  }, [restoreFocus, selection]);

  useEffect(() => {
    if (!eligible || !focused) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search-suggestions?${key}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search suggestions unavailable.");
        const suggestions = readSuggestions(await response.json());
        if (active) setResult({ key, status: "ready", suggestions });
      } catch {
        if (active) setResult({ key, status: "error" });
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, eligible, focused]);

  const message =
    status === "error"
      ? "Suggestions unavailable. You can still search with your text."
      : status === "loading"
        ? "Finding nearby suggestions…"
        : suggestions.length
          ? `${suggestions.length} nearby suggestions. You can also use your own text.`
          : "No nearby suggestions. You can still search with your text.";

  return (
    <Autocomplete
      value={value}
      onValueChange={onChange}
      filter={false}
      autoHighlight={false}
      openOnFocus
      open={open && eligible}
      onOpenChange={setOpen}
      status={status}
      presentation="popover"
      name="q"
    >
      <div className="input-icon">
        <Search size={17} aria-hidden="true" />
        <AutocompleteInput
          ref={input}
          id={id}
          aria-label="Provider or town"
          aria-describedby={`${id}-hint`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open && eligible)
              event.stopPropagation();
          }}
          autoComplete="off"
          placeholder="Search by name or town"
          maxLength={200}
        />
      </div>
      <AutocompleteContent className={styles.content} collisionPadding={12}>
        <AutocompleteList className={styles.list}>
          {suggestions.map((suggestion) => (
            <AutocompleteItem
              key={suggestion.id}
              value={suggestion.id}
              label={suggestion.value}
              className={styles.item}
            >
              <span>{providerDisplayName(suggestion.value)}</span>
              <small>{suggestion.detail}</small>
            </AutocompleteItem>
          ))}
        </AutocompleteList>
        <div className={styles.message}>{message}</div>
      </AutocompleteContent>
      <span id={`${id}-hint`} className={styles.srOnly} role="status">
        {focused && eligible
          ? message
          : "Type a provider or town. Choosing a suggestion is optional."}
      </span>
    </Autocomplete>
  );
}
