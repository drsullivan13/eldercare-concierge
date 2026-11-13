import type {
  LocationResearchResponse,
  OfferingFact,
  ResearchSource,
} from "@/lib/location-research-types";
import type { Provider } from "@/lib/providers";
import styles from "./compare-decision-rows.module.css";

type SourcedFact = {
  text: string;
  source: ResearchSource;
};

function compactText(text: string) {
  const compact = text
    .replace(/^The provider lists /i, "")
    .replace(/ floor plans with published room rates:/i, ":")
    .replace(/^[^:]+ lists:\s*/i, "")
    .replace(
      /\s*Confirm (?:these details with the location|the current quote)\./gi,
      "",
    )
    .trim();
  return compact.charAt(0).toUpperCase() + compact.slice(1);
}

function factKey(text: string) {
  return compactText(text).toLowerCase().replace(/[.]+$/, "").trim();
}

function sourcedFacts(
  data: LocationResearchResponse | null,
  kind: OfferingFact["kind"],
): SourcedFact[] {
  if (!data) return [];
  return data.facts.flatMap((fact) => {
    if (fact.kind !== kind) return [];
    const source = data.sources.find((item) => item.id === fact.sourceId);
    if (
      !source ||
      source.kind === "regulator" ||
      !/^https?:\/\//i.test(source.url)
    )
      return [];
    const text = compactText(fact.text);
    if (!text || text.length > 220) return [];
    return [{ text, source }];
  });
}

function distinctCells(cells: SourcedFact[][]) {
  const populated = cells.filter((cell) => cell.length);
  if (populated.length < 2) return cells.map(() => []);
  const keys = populated.map(
    (cell) => new Set(cell.map((fact) => factKey(fact.text))),
  );
  const different = cells.map((cell) =>
    cell
      .filter((fact) => !keys.every((set) => set.has(factKey(fact.text))))
      .filter(
        (fact, index, facts) =>
          facts.findIndex(
            (item) => factKey(item.text) === factKey(fact.text),
          ) === index,
      ),
  );
  return different.some((cell) => cell.length)
    ? different.map((cell, index) =>
        cell.length ? cell : cells[index].slice(0, 1),
      )
    : different;
}

function roomFacts(data: LocationResearchResponse | null) {
  return sourcedFacts(data, "room").flatMap((fact) =>
    fact.text.split(/;\s*/).map((text) => ({
      ...fact,
      text: text.trim(),
    })),
  );
}

export function CompareDecisionRows({
  providers,
  research,
}: {
  providers: readonly Provider[];
  research: readonly (LocationResearchResponse | null)[];
}) {
  const aligned = providers.map((provider, index) =>
    research[index]?.providerId === provider.id ? research[index] : null,
  );
  const candidates = [
    {
      label: "Care options",
      cells: aligned.map((data) => sourcedFacts(data, "care")),
    },
    { label: "Room choices", cells: aligned.map(roomFacts) },
  ];
  const rows = candidates
    .map(({ label, cells }) => ({ label, cells: distinctCells(cells) }))
    .filter((row) => row.cells.some((cell) => cell.length));
  if (!rows.length) return null;
  return (
    <section
      className={styles.rows}
      aria-label="Differences in published offerings"
    >
      {rows.map(({ label, cells }) => (
        <div className={styles.row} key={label}>
          <h3 className={styles.heading}>{label}</h3>
          {cells.map((cell, i) => {
            const visible = cell.slice(0, 2);
            const sources = [...new Set(visible.map((fact) => fact.source))];
            return (
              <div
                className={styles.cell}
                key={providers[i].id}
                role="group"
                aria-label={`${providers[i].name}, ${label.toLowerCase()}`}
              >
                <ul>
                  {visible.map((fact) => (
                    <li key={fact.text}>{fact.text}</li>
                  ))}
                </ul>
                <small>
                  {sources.map((source, j) => (
                    <span key={source.id}>
                      {j > 0 && " · "}
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.publisher}
                      </a>
                      {source.access === "search-result" && " (search preview)"}
                    </span>
                  ))}
                </small>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
