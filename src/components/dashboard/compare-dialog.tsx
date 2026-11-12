import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Modal } from "../modal";
import { CATEGORY_LABELS, type Provider } from "@/lib/providers";

/** Keep selected records available when a filter removes them from the result list. */
export function useComparison() {
  const [providers, setProviders] = useState<Provider[]>([]);
  return {
    providers,
    contains: (id: string) => providers.some((provider) => provider.id === id),
    clear: () => setProviders([]),
    toggle(provider: Provider) {
      if (providers.some((selected) => selected.id === provider.id)) {
        setProviders((current) =>
          current.filter((selected) => selected.id !== provider.id),
        );
      } else {
        if (providers.length >= 3) return false;
        setProviders((current) => [...current, provider]);
      }
      return true;
    },
  };
}

export function ComparisonTray({
  comparison,
  openProvider,
}: {
  comparison: ReturnType<typeof useComparison>;
  openProvider: (provider: Provider) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!comparison.providers.length) return null;
  return (
    <>
      <div className="compare-bar">
        <span>
          <strong>{comparison.providers.length}</strong> of 3 options selected
        </span>
        <button className="text-link" onClick={comparison.clear}>
          Clear
        </button>
        <button
          className="button button-primary"
          disabled={comparison.providers.length < 2}
          onClick={() => setOpen(true)}
        >
          Compare options <ArrowRight size={16} />
        </button>
      </div>
      {open && (
        <CompareDialog
          providers={comparison.providers}
          close={() => setOpen(false)}
          open={(provider) => {
            setOpen(false);
            openProvider(provider);
          }}
        />
      )}
    </>
  );
}

function CompareDialog({
  providers,
  close,
  open,
}: {
  providers: Provider[];
  close: () => void;
  open: (p: Provider) => void;
}) {
  const mixed = new Set(providers.map((p) => p.category)).size > 1;
  return (
    <Modal title="Compare care options" close={close} wide>
      <span className="eyebrow">YOUR OPTIONS, SIDE BY SIDE</span>
      <h2>Look at the details together.</h2>
      {mixed && (
        <div className="inline-notice">
          These are different types of care. A CMS nursing-home rating cannot be
          used to judge an assisted-living residence or home-care agency.
        </div>
      )}
      <div className="comparison-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>What to look at</th>
              {providers.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                label: "Care setting",
                value: (p: Provider) => CATEGORY_LABELS[p.category],
              },
              {
                label: "Location",
                value: (p: Provider) =>
                  `${p.city}, ${p.zip}${p.locationKind === "office" ? " (office)" : ""}`,
              },
              ...(
                [
                  ["CMS overall", "overall"],
                  ["CMS health inspections", "inspections"],
                  ["CMS staffing", "staffing"],
                ] as const
              ).map(([label, field]) => ({
                label,
                value(p: Provider) {
                  if (p.category !== "nursing-home" || !p.cms)
                    return "Not applicable";
                  const rating = p.cms[field];
                  return rating === null ? "Not published" : `${rating} / 5`;
                },
              })),
              {
                label: "Public record",
                value: (p: Provider) =>
                  p.officialRecord
                    ? "Official record linked"
                    : "Provider information only",
              },
              {
                label: "Flags to review",
                value: (p: Provider) =>
                  p.warnings.join(" ") ||
                  "No flags surfaced in this snapshot. This is not clearance.",
              },
              { label: "Current availability", value: () => "Not confirmed" },
              {
                label: "Availability evidence",
                value: (p: Provider) =>
                  p.research?.availabilityStatus === "opening-published"
                    ? "Provider publishes an opening claim; confirm room and date"
                    : p.research?.availabilityStatus === "waitlist-published"
                      ? "Published waitlist; confirm timing"
                      : "Inquiry needed",
              },
              {
                label: "Published cost details",
                value: (p: Provider) =>
                  p.research?.publishedCosts
                    ? `${p.research.publishedCosts} sourced fee entries; open room & cost details`
                    : "Not established in this research",
              },
              {
                label: "Consumer experience index",
                value: (p: Provider) =>
                  p.research?.experience.value != null
                    ? `${p.research.experience.value.toFixed(1)} / 10 · ${p.research.experience.publicationStatus === "single-source-estimate" ? "Single-source estimate · " + p.research.experience.singleSourceLabel : p.research.experience.confidence + " evidence"}`
                    : p.research?.experience.publicationStatus ===
                        "sources-disagree"
                      ? "Harbor score withheld · Sources disagree"
                      : "Not rated",
              },
            ].map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {providers.map((p) => (
                  <td key={p.id}>{row.value(p)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th>Source details</th>
              {providers.map((p) => (
                <td key={p.id}>
                  <button className="text-link" onClick={() => open(p)}>
                    View evidence <ArrowUpRight size={14} />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
