"use client";

import { useId, useRef, useState, type ComponentType } from "react";
import { Search } from "lucide-react";
import styles from "./provider-town-autocomplete.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  zip: string;
  radius: string;
  category: string;
};

export type AutocompleteControlProps = Props & {
  id: string;
  restoreFocus: boolean;
  selection: [number | null, number | null];
};

export function ProviderTownAutocomplete(props: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const loading = useRef(false);
  const [loaded, setLoaded] = useState<{
    Control: ComponentType<AutocompleteControlProps>;
    restoreFocus: boolean;
    selection: [number | null, number | null];
  } | null>(null);
  const focused = useRef(false);

  async function activate() {
    focused.current = true;
    if (loading.current) return;
    loading.current = true;
    try {
      const control = await import("./provider-town-autocomplete-control");
      setLoaded({
        Control: control.default,
        restoreFocus: focused.current,
        selection: [
          input.current?.selectionStart ?? null,
          input.current?.selectionEnd ?? null,
        ],
      });
    } catch {
      loading.current = false;
    }
  }

  return (
    <div className={`name-search ${styles.field}`}>
      <label htmlFor={id}>Provider or town</label>
      {loaded ? (
        <loaded.Control
          {...props}
          id={id}
          restoreFocus={loaded.restoreFocus}
          selection={loaded.selection}
        />
      ) : (
        <div className="input-icon">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            id={id}
            name="q"
            aria-label="Provider or town"
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            onFocus={activate}
            onBlur={() => {
              focused.current = false;
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={false}
            aria-controls={`${id}-loading-list`}
            autoComplete="off"
            placeholder="Search by name or town"
            maxLength={200}
          />
          <div id={`${id}-loading-list`} role="listbox" hidden />
        </div>
      )}
    </div>
  );
}
