import { Fragment, useId, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Modal } from "../modal";
import { evidenceDate } from "../evidence-date";
import { providerCareAlerts } from "../provider-card";
import { providerDisplayName } from "../provider-display-name";
import { CATEGORY_LABELS, type Provider } from "@/lib/providers";
import { ComparePlaceFacts } from "./compare-place-facts";
import styles from "./family-compare.module.css";

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
      <div className={styles.tray} aria-label="Comparison selections">
        <span aria-live="polite">
          <strong>{comparison.providers.length}</strong> of 3 selected
        </span>
        <button className={styles.link} onClick={comparison.clear}>
          Clear
        </button>
        <button
          className={styles.primary}
          disabled={comparison.providers.length < 2}
          onClick={() => setOpen(true)}
        >
          Compare <ArrowRight size={16} />
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
  const uid = useId();
  const [omittedId, setOmittedId] = useState(providers[2]?.id);
  const pair = providers
    .filter((provider) => provider.id !== omittedId)
    .slice(0, 2);
  const warnings = pair.map((provider) => [
    ...new Set([
      ...providerCareAlerts(provider),
      ...(provider.research?.admissionRestriction
        ? [provider.research.admissionRestriction]
        : []),
    ]),
  ]);
  const rows: {
    label: string;
    value: (provider: Provider) => ReactNode;
  }[] = [
    ...(["overall", "inspections", "staffing", "quality"] as const).map(
      (field) => ({
        label: `CMS ${field === "inspections" ? "health inspections" : field}`,
        value: (provider: Provider) =>
          provider.category !== "nursing-home" ? (
            "Not applicable to this care setting"
          ) : provider.cms?.[field] == null ? (
            "Not published"
          ) : (
            <>
              <strong>{provider.cms[field]} / 5</strong>
              <small>As of {evidenceDate(provider.cms.dataAsOf)}</small>
            </>
          ),
      }),
    ),
    {
      label: "Availability",
      value: (provider) => (
        <>
          <strong>
            {provider.research?.availabilityStatus === "opening-published"
              ? "Opening claim published"
              : provider.research?.availabilityStatus === "waitlist-published"
                ? "Waitlist published"
                : "Inquiry needed"}
          </strong>
          <small>
            Not confirmed live.
            {provider.research?.availabilityCheckedAt &&
              ` Checked ${evidenceDate(provider.research.availabilityCheckedAt)}.`}
          </small>
        </>
      ),
    },
    {
      label: "Provider research notes",
      value: (provider) => {
        const alerts = providerCareAlerts(provider);
        const notes = provider.warnings.filter(
          (warning) => !alerts.includes(warning),
        );
        return notes.length ? (
          <ul className={styles.list}>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : (
          "No additional research notes."
        );
      },
    },
    {
      label: "Records & sources",
      value: (provider) => (
        <>
          <p>
            {provider.officialRecord
              ? "Official record linked"
              : "Provider information only"}
          </p>
          {provider.category === "home-health" && (
            <small>
              Agency clinical measures and patient surveys are separate.
            </small>
          )}
          <ul className={styles.sources}>
            {provider.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <small>
                  {source.publisher} · Checked {evidenceDate(source.checkedAt)}
                  {source.dataAsOf &&
                    ` · Data as of ${evidenceDate(source.dataAsOf)}`}
                </small>
                <small>{source.supports}</small>
              </li>
            ))}
          </ul>
          <button className={styles.link} onClick={() => open(provider)}>
            View all evidence <ArrowUpRight size={14} />
          </button>
        </>
      ),
    },
  ];

  return (
    <Modal title="Compare places" close={close} wide>
      <div className={styles.comparison}>
        <header className={styles.compareHeading}>
          <h2>Compare places</h2>
          {providers.length === 3 && (
            <label className={styles.pairSelector}>
              <span>Compare pair</span>
              <select
                value={omittedId ?? providers[2].id}
                onChange={(event) => setOmittedId(event.target.value)}
              >
                {providers.toReversed().map((omitted) => (
                  <option key={omitted.id} value={omitted.id}>
                    {providers
                      .filter((provider) => provider.id !== omitted.id)
                      .map((provider) => provider.name)
                      .join(" + ")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <div
          className={styles.scroll}
          role="region"
          aria-label="Places comparison"
          tabIndex={0}
        >
          <div className={styles.identities}>
            {pair.map((provider) => (
              <div key={provider.id} className={styles.identity}>
                <button
                  className={styles.providerName}
                  onClick={() => open(provider)}
                  aria-label={provider.name}
                >
                  {providerDisplayName(provider.name)} <ArrowUpRight size={14} />
                </button>
                <span className={styles.category}>
                  {CATEGORY_LABELS[provider.category]}
                </span>
                <span className={styles.locality}>
                  {providerDisplayName(provider.city)}, {provider.state}
                  {provider.locationKind === "office"
                    ? " · Office only"
                    : provider.locationKind === "zip"
                      ? " · ZIP estimate"
                      : ""}
                </span>
              </div>
            ))}
          </div>
          {warnings.some((items) => items.length > 0) && (
            <section
              className={styles.aligned}
              aria-labelledby={`${uid}-warnings`}
            >
              <h3 className={styles.warningHeading} id={`${uid}-warnings`}>
                Important warnings
              </h3>
              {pair.map((provider, index) => (
                <div
                  key={provider.id}
                  className={`${styles.cell} ${styles.warning}`}
                  role="group"
                  aria-label={`${provider.name}, warnings`}
                >
                  {warnings[index].length ? (
                    <>
                      <ul className={styles.list}>
                        {warnings[index].map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                      <button
                        className={styles.link}
                        onClick={() => open(provider)}
                      >
                        Warning evidence <ArrowUpRight size={14} />
                      </button>
                    </>
                  ) : (
                    <p>No flags surfaced. Not a safety clearance.</p>
                  )}
                </div>
              ))}
            </section>
          )}
          <ComparePlaceFacts providers={pair} />
          <section
            className={styles.aligned}
            aria-labelledby={`${uid}-experience`}
          >
            <h3 className={styles.band} id={`${uid}-experience`}>
              Consumer experience
              <small>Published reviews, not clinical quality or safety.</small>
            </h3>
            {pair.map((provider) => {
              const experience = provider.research?.experience;
              return (
                <div
                  key={provider.id}
                  className={styles.cell}
                  role="group"
                  aria-label={`${provider.name}, consumer experience`}
                >
                  {experience?.value == null ? (
                    <strong>
                      {experience?.publicationStatus === "sources-disagree"
                        ? "Score withheld · Sources disagree"
                        : "Not enough evidence to score"}
                    </strong>
                  ) : (
                    <>
                      <strong className={styles.score}>
                        {experience.value.toFixed(1)} <small>/ 10</small>
                      </strong>
                      <p>
                        {experience.publicationStatus ===
                        "single-source-estimate"
                          ? `Single-source estimate · ${experience.singleSourceLabel ?? "one review source"}`
                          : `${experience.confidence === "moderate" ? "Moderate" : "Limited"} evidence`}
                      </p>
                    </>
                  )}
                  {experience && experience.independentSourceCount > 0 && (
                    <small>
                      {experience.reviewCount.toLocaleString()} reviews reported
                      · {experience.independentSourceCount} source{" "}
                      {experience.independentSourceCount === 1
                        ? "family"
                        : "families"}
                      . Aggregate counts, not unique people or accounts read by
                      Harbor.
                    </small>
                  )}
                  {experience?.selectedConcerns && (
                    <small>Selected reviews include concerns.</small>
                  )}
                  <button
                    className={styles.link}
                    onClick={() => open(provider)}
                  >
                    Review sources <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </section>
          <details className={styles.secondaryDetails}>
            <summary>Clinical ratings, availability & records</summary>
            <p className={styles.scope}>
              CMS ratings apply only to the certified nursing home, not an
              entire campus or another care setting.
            </p>
            <div className={styles.aligned}>
              {rows.map((row) => (
                <Fragment key={row.label}>
                  <h3 className={styles.band}>{row.label}</h3>
                  {pair.map((provider) => (
                    <div
                      key={provider.id}
                      className={styles.cell}
                      role="group"
                      aria-label={`${provider.name}, ${row.label}`}
                    >
                      {row.value(provider)}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </details>
        </div>
      </div>
    </Modal>
  );
}
