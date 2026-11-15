import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
  const checkedAt = text(branch.checkedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) ||
    new Date(`${checkedAt}T00:00:00Z`).toISOString().slice(0, 10) !==
      checkedAt ||
    checkedAt > new Date().toISOString().slice(0, 10)
  )
    throw new Error("Expected a real, nonfuture checked date.");
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

const output =
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceFile,
      sourceSha256: createHash("sha256").update(raw).digest("hex"),
      offices,
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
console.log(`Verified ${offices.length} exact-office directory records.`);
