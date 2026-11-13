"use client";

import { List, Map as MapIcon } from "lucide-react";
import { useId } from "react";

const views = [
  { showMap: false, label: "List view", Icon: List },
  { showMap: true, label: "Map view", Icon: MapIcon },
];

export function ResultViewControl({
  showMap,
  onChange,
}: {
  showMap: boolean;
  onChange: (showMap: boolean) => void;
}) {
  const name = useId();

  return (
    <div
      className="result-view-control"
      role="radiogroup"
      aria-label="Result view"
    >
      {views.map((view) => (
        <label key={view.label} title={view.label}>
          <input
            type="radio"
            name={name}
            value={view.showMap ? "map" : "list"}
            aria-label={view.label}
            checked={showMap === view.showMap}
            onChange={() => onChange(view.showMap)}
          />
          <span aria-hidden="true">
            <view.Icon size={18} />
          </span>
        </label>
      ))}
    </div>
  );
}
