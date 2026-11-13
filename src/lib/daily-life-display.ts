import type {
  LocationResearchResponse,
  OfferingFact,
  ResearchSource,
} from "./location-research-types";
import type {
  DailyLifeFact as AcquiredFact,
  DailyLifeNumeric,
} from "./daily-life-types";
import { isServiceProvider, type Provider } from "./providers";

type DailyLifeCategory =
  "dining" | "activity" | "amenity" | "staffing" | "care";
type DailyLifeFact = {
  fact: OfferingFact & {
    evidence?: "provider-reported";
    numeric?: DailyLifeNumeric;
    acquiredKind?: AcquiredFact["kind"];
  };
  source: ResearchSource;
};

const acquiredCategories = {
  dining: "dining",
  "care-support": "care",
  staffing: "staffing",
  activity: "activity",
  trip: "activity",
  transport: "amenity",
} satisfies Record<AcquiredFact["kind"], DailyLifeCategory>;

const categories: {
  id: DailyLifeCategory;
  facility: string;
  office: string;
}[] = [
  {
    id: "dining",
    facility: "Meals & dining",
    office: "Help with meals at home",
  },
  {
    id: "activity",
    facility: "Social life & outings",
    office: "Companionship & outings",
  },
  {
    id: "amenity",
    facility: "Everyday comforts & transport",
    office: "Everyday help & transport",
  },
  {
    id: "staffing",
    facility: "Staff roles & support",
    office: "Care team & visit support",
  },
  {
    id: "care",
    facility: "Care & daily support",
    office: "Services arranged through this office",
  },
];

export function dailyLife(
  data: Pick<LocationResearchResponse, "facts" | "sources" | "dailyLife">,
  provider: Provider,
) {
  const office = isServiceProvider(provider);
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  const groups = new Map<DailyLifeCategory, DailyLifeFact[]>();
  for (const fact of data.facts) {
    const source = sources.get(fact.sourceId);
    if (
      !source ||
      source.kind === "regulator" ||
      (fact.kind !== "dining" &&
        fact.kind !== "activity" &&
        fact.kind !== "amenity" &&
        fact.kind !== "care")
    )
      continue;
    const category =
      fact.kind === "care"
        ? /\b(nurs(?:e|es|ing)|staff|caregiver|care manager|ratio|resident.day)\b/i.test(
            fact.text,
          )
          ? "staffing"
          : "care"
        : fact.kind;
    const entries = groups.get(category) ?? [];
    entries.push({ fact, source });
    groups.set(category, entries);
  }
  if (data.dailyLife?.providerId === provider.id) {
    const acquiredSources = new Map(
      data.dailyLife.sources.map((source) => [source.id, source]),
    );
    for (const fact of data.dailyLife.facts) {
      const source = acquiredSources.get(fact.sourceId);
      if (!source) continue;
      const category = acquiredCategories[fact.kind];
      const entries = groups.get(category) ?? [];
      if (
        entries.some(
          (entry) =>
            entry.source.url === source.url && entry.fact.text === fact.text,
        )
      )
        continue;
      entries.push({
        fact: {
          id: `daily-life-${fact.id}`,
          kind: category === "staffing" ? "care" : category,
          text: fact.text,
          sourceId: `daily-life-${source.id}`,
          asOf: source.publishedAt,
          evidence: fact.evidence,
          numeric: fact.numeric,
          acquiredKind: fact.kind,
        },
        source: { ...source, id: `daily-life-${source.id}`, kind: "provider" },
      });
      groups.set(category, entries);
    }
  }
  const text = [...groups.values()]
    .flat()
    .map(({ fact }) => fact.text)
    .join(" ");
  const publishedTransport = [...groups.values()]
    .flat()
    .some(
      ({ fact }) =>
        fact.acquiredKind === "trip" || fact.acquiredKind === "transport",
    );
  const publishedRatio = (groups.get("staffing") ?? []).some(
    ({ fact }) =>
      fact.numeric?.unit === "staff-to-resident-ratio" ||
      /\b\d+\s*:\s*\d+\b|\b\d+\s+(?:staff|nurses?|aides?|caregivers?)\s+(?:per|for(?: every)?|to)\s+\d+\s+residents?\b/i.test(
        fact.text,
      ),
  );
  const gaps = [
    !groups.has("dining") &&
      !/\b(meal|meals|dining|diet|diets|menu|menus|chef|food)\b/i.test(text) &&
      (office ? "meal preparation" : "meals & dining"),
    !groups.has("activity") &&
      !/\b(activit(?:y|ies)|outings|companionship|classes|exercise)\b/i.test(
        text,
      ) &&
      (office ? "companionship & outings" : "activities & outings"),
    !publishedTransport &&
      !/\b(transport(?:ation)?|escort|escorts|rides|shuttle)\b/i.test(text) &&
      "transport arrangements",
  ].filter((gap): gap is string => Boolean(gap));
  return {
    office,
    publishedRatio,
    groups: categories.flatMap((category) => {
      const facts = groups.get(category.id);
      return facts?.length
        ? [
            {
              id: category.id,
              title: office ? category.office : category.facility,
              facts,
            },
          ]
        : [];
    }),
    gaps,
  };
}
