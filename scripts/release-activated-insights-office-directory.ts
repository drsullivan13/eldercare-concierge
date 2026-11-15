import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getRegistrationFacts } from "../src/lib/registration-facts";
import { getMarket } from "../src/lib/markets";
import type { OfficeDirectoryResearch } from "../src/lib/location-research-types";

const root = new URL("../", import.meta.url);
const sourceFile = "research/north-jersey/home-care-pulse/branches.json";
const outputFile = new URL(
  "src/data/activated-insights-office-directory.json",
  root,
);
const raw = readFileSync(new URL(sourceFile, root), "utf8");
const branches: unknown = JSON.parse(raw);
if (!Array.isArray(branches))
  throw new Error("Expected directory branch rows.");
const catalog = getMarket("north-jersey")!.providers;
const ids = new Set<string>();

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Expected a nonempty directory field.");
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Expected directory string list.");
  return value.map(text);
}

function checkedDate(value: unknown) {
  const checkedAt = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) ||
    new Date(`${checkedAt}T00:00:00Z`).toISOString().slice(0, 10) !==
      checkedAt ||
    checkedAt > new Date().toISOString().slice(0, 10)
  )
    throw new Error("Expected a real, nonfuture checked date.");
  return checkedAt;
}

const offices: OfficeDirectoryResearch[] = branches.map((branch) => {
  const providerId = text(branch.providerId);
  const provider = catalog.find((provider) => provider.id === providerId);
  if (!provider || provider.category !== "home-care" || ids.has(providerId))
    throw new Error(
      "Release requires unique runtime NJ home-care provider IDs.",
    );
  ids.add(providerId);
  const address = text(branch.address);
  if (
    !address.endsWith(`NJ, ${provider.zip}`) ||
    !address.toLowerCase().includes(`, ${provider.city.toLowerCase()},`) ||
    address.match(/^\d+/)?.[0] !== provider.address.match(/^\d+/)?.[0]
  )
    throw new Error(`Review directory office identity for ${providerId}.`);
  const sourceUrl = text(branch.sourceUrl);
  const url = new URL(sourceUrl);
  if (
    url.origin !== "https://awards.activatedinsights.com" ||
    !/^\/agency\/[a-z0-9-]+\/$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Expected an exact Activated Insights agency page.");
  const checkedAt = checkedDate(branch.checkedAt);
  if (!Array.isArray(branch.awards))
    throw new Error("Expected directory award rows.");
  const awards: OfficeDirectoryResearch["awards"] = branch.awards
    .filter((award: { name: unknown }) => award.name === "Provider of Choice")
    .map((award: { years: unknown }) => {
      if (
        !Array.isArray(award.years) ||
        !award.years.length ||
        !award.years.every(
          (year) =>
            Number.isInteger(year) &&
            year >= 2000 &&
            year <= Number(checkedAt.slice(0, 4)),
        )
      )
        throw new Error("Expected published Provider of Choice award years.");
      return { name: "Provider of Choice", years: [...award.years] };
    });
  return {
    providerId,
    office: { name: text(branch.title), address },
    source: {
      id: `activated-insights-${providerId}`,
      url: sourceUrl,
      title: text(branch.title),
      publisher: "Activated Insights",
      kind: "public-directory",
      checkedAt,
      publishedAt: null,
      access: "full-page",
    },
    services: strings(branch.services),
    paymentOptions: strings(branch.paymentOptions),
    awards,
  };
});

const annualFile =
  "research/north-jersey/home-care-pulse/annual-client-awards.json";
const annualUrls = new Map([
  [2022, "https://activatedinsights.com/latest-news/2022-provider-of-choice/"],
  [
    2023,
    "https://activatedinsights.com/articles/2023-best-of-home-care-provider-of-choice-award-winners/",
  ],
  [
    2024,
    "https://activatedinsights.com/articles/2024-best-of-home-care-provider-of-choice-award-winners/",
  ],
  [
    2025,
    "https://awards.activatedinsights.com/portfolio-items/provider-of-choice-2025-winners/",
  ],
  [
    2026,
    "https://awards.activatedinsights.com/portfolio-items/provider-of-choice-2026-winners/",
  ],
]);

type Winner = { year: number; namedRecipient: string; sourceUrl: string };
type AnnualTeam = {
  providerId: string;
  registration: string;
  businessName: string;
  registeredTradeName?: string | null;
  registryAddress: string;
  registryCity: string;
  registryZip: string;
  phone: string;
  checkedAt: string;
  awards: Winner[];
  operatorReceipt?: {
    url: string;
    teamCode: string;
    teamNumber: string | number;
    address: string;
    city: string;
    zip: string;
    phone?: string;
    registration?: string;
  };
};
function normalizedName(value: string) {
  return value
    .toUpperCase()
    .replace(/\bN\.(?=\s)/g, "NORTH")
    .replace(/\bNJ\b/g, "NEW JERSEY")
    .replace(/\bNORTH WEST\b/g, "NORTHWEST")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
function officeStreet(value: string) {
  const words: Record<string, string> = {
    STREET: "ST",
    ROAD: "RD",
    AVENUE: "AVE",
    BOULEVARD: "BLVD",
    DRIVE: "DR",
    NORTH: "N",
    SOUTH: "S",
    EAST: "E",
    WEST: "W",
    ROUTE: "RT",
    CENTER: "CTR",
    SUITE: "STE",
    FLOOR: "FL",
    HIGHWAY: "HWY",
    PLACE: "PL",
  };
  return value
    .toUpperCase()
    .replace(/#/g, " STE ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => words[word] ?? word)
    .join(" ");
}

export function mergeAnnualClientAwards(
  offices: OfficeDirectoryResearch[],
  teams: AnnualTeam[],
) {
  if (!Array.isArray(teams))
    throw new Error("Expected reviewed annual award teams.");
  const byId = new Map(
    offices.map((office) => [office.providerId, { ...office }]),
  );
  const homes = catalog.filter(
    (p) => p.state === "NJ" && p.category === "home-care",
  );
  const namedOffices = new Map<string, Set<string>>();
  for (const provider of homes) {
    const state = getRegistrationFacts(provider);
    if (!state) continue;
    for (const name of [
      state.businessName,
      state.dbas,
      ...(state.dbas ?? "").split(","),
    ]) {
      if (!name?.trim()) continue;
      const key = normalizedName(name);
      if (!namedOffices.has(key)) namedOffices.set(key, new Set());
      namedOffices.get(key)!.add(provider.id);
    }
  }
  const teamIds = new Set<string>();
  const awardOwners = new Map<string, string>();
  for (const team of teams) {
    const p = homes.find((office) => office.id === team.providerId);
    const state = p && getRegistrationFacts(p);
    if (
      !p ||
      !state ||
      teamIds.has(p.id) ||
      team.registration !== state.registration ||
      team.businessName !== state.businessName ||
      team.registryAddress !== p.address ||
      team.registryCity !== p.city ||
      team.registryZip !== p.zip ||
      team.phone !== p.phone ||
      !Array.isArray(team.awards) ||
      !team.awards.length
    )
      throw new Error("Annual client award office identity mismatch.");
    teamIds.add(p.id);
    const checkedAt = checkedDate(team.checkedAt);
    const proof = team.operatorReceipt;
    if (proof) {
      const citySlug = p.city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const uniqueAddress =
        homes.filter(
          (other) =>
            other.zip === p.zip &&
            officeStreet(other.address) === officeStreet(p.address),
        ).length === 1;
      const teamUrl = new RegExp(
        "^https://www\\.bayada\\.com/office/nj/" +
          citySlug +
          "/personal-and-companion-care/[a-z0-9-]+-[0-9]+$",
      );
      if (
        !teamUrl.test(text(proof.url)) ||
        !/^[A-Z]{2,6}$/.test(text(proof.teamCode)) ||
        !/^[1-9]\d*$/.test(String(proof.teamNumber)) ||
        !/\bBAYADA\b/i.test(p.name) ||
        officeStreet(proof.address) !== officeStreet(p.address) ||
        normalizedName(proof.city) !== normalizedName(p.city) ||
        proof.zip !== p.zip ||
        !(
          uniqueAddress ||
          proof.registration === state.registration ||
          (proof.phone &&
            proof.phone.replace(/\D/g, "") === p.phone?.replace(/\D/g, ""))
        )
      )
        throw new Error(
          "BAYADA award requires a corroborated local operator team.",
        );
    } else {
      const alias = normalizedName(text(team.registeredTradeName));
      const owners = namedOffices.get(alias);
      if (owners?.size !== 1 || !owners.has(p.id))
        throw new Error(
          "Award recipient must resolve to a unique registered name.",
        );
    }
    let office = byId.get(p.id);
    const verified = new Map<number, string>();
    for (const award of team.awards) {
      const name = normalizedName(text(award.namedRecipient));
      if (
        annualUrls.get(award.year) !== text(award.sourceUrl) ||
        award.year > Number(checkedAt.slice(0, 4))
      )
        throw new Error("Unexpected annual award edition or year.");
      if (proof) {
        const code = award.namedRecipient.match(
          /\(\s*([A-Z]{2,6})\s*[-–—]\s*(\d+)\s*\)\s*$/,
        );
        if (
          !/^BAYADA\b/.test(name) ||
          !code ||
          code[1] !== proof.teamCode ||
          code[2] !== String(proof.teamNumber)
        )
          throw new Error(
            "Publisher recipient does not name the exact BAYADA team.",
          );
      } else if (name !== normalizedName(text(team.registeredTradeName)))
        throw new Error("Publisher recipient differs from registered name.");
      const key =
        award.year +
        ":" +
        (proof ? proof.teamCode + "-" + proof.teamNumber : name);
      if (awardOwners.has(key) && awardOwners.get(key) !== p.id)
        throw new Error("Award assigned to multiple offices.");
      awardOwners.set(key, p.id);
      verified.set(award.year, award.sourceUrl);
    }
    const annualSources = [...verified]
      .sort(([a], [b]) => b - a)
      .map(([year, url]) => ({ year, url }));
    if (!office) {
      office = {
        providerId: p.id,
        office: {
          name: team.awards[0].namedRecipient,
          address: [p.address, p.city, p.state, p.zip].join(", "),
        },
        source: {
          id: "activated-insights-" + p.id,
          url: annualSources[0].url,
          title: "Best of Home Care – Provider of Choice",
          publisher: "Activated Insights",
          kind: "public-directory",
          checkedAt,
          publishedAt: null,
          access: "full-page",
        },
        services: [],
        paymentOptions: [],
        awards: [],
      };
      byId.set(p.id, office);
    }
    const years = [
      ...new Set([
        ...office.awards.flatMap((a) => a.years),
        ...verified.keys(),
      ]),
    ].sort((a, b) => b - a);
    office.awards = [{ name: "Provider of Choice", years, annualSources }];
  }
  return [...byId.values()];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const annualRaw = readFileSync(new URL(annualFile, root), "utf8");
  const merged = mergeAnnualClientAwards(offices, JSON.parse(annualRaw));
  const output =
    JSON.stringify(
      {
        schemaVersion: 1,
        sourceFile,
        sourceSha256: createHash("sha256").update(raw).digest("hex"),
        annualFile,
        annualSha256: createHash("sha256").update(annualRaw).digest("hex"),
        offices: merged,
      },
      null,
      2,
    ) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(outputFile, "utf8") !== output)
      throw new Error(
        "Office directory release differs from reviewed projection.",
      );
  } else {
    writeFileSync(outputFile, output);
  }
  console.log(`Verified ${merged.length} exact-office directory records.`);
}
