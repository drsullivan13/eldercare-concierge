import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import scopeClaims from "../research/north-jersey/home-care-pulse/cahc-scope-claims.json";
import markets from "../src/data/regional-markets.json";
import type { OfficeDirectoryResearch } from "../src/lib/location-research-types";
import type { Provider } from "../src/lib/providers";

type CatalogOffice = Pick<
  Provider,
  "id" | "address" | "city" | "state" | "zip" | "phone"
> & { category: string };
type AssociationOffice = OfficeDirectoryResearch & {
  accreditations?: string[];
};

const root = new URL("../", import.meta.url);
const directory = "research/north-jersey/home-care-pulse/";
const inputFiles = [
  `${directory}association-branches.json`,
  `${directory}cahc-branches.json`,
  `${directory}cahc-decisions.json`,
  `${directory}cahc-scope-claims.json`,
];
const outputFile = new URL(
  "src/data/home-care-association-directories.json",
  root,
);
const hchanjPdf =
  "https://higherlogicdownload.s3.amazonaws.com/HOMECARENJ/c98377c8-a111-4b58-bbb5-0128aed8a16f/UploadedImages/HCHANJ_26_Edition_FINAL_LR.pdf";
const publishers = {
  hchanj: "Home Care & Hospice Association of New Jersey",
  cahc: "Commission on Accreditation for Home Care",
};
const scopeByLabel: Readonly<Record<string, string | undefined>> = scopeClaims;
const acceptedClaims = new Set(Object.values(scopeClaims));
const reviewedAddressDifferences = [
  {
    providerId: "north-jersey-hp-hp0148500",
    source: "348 Applegarth Road Monroe Township, NJ 08831",
    catalog: "348 APPLEGARTH ROAD MONROE NJ 08831",
  },
  {
    providerId: "north-jersey-hp-hp0395000",
    source: "30 Knightsbridge Road Piscataway, NJ 08854",
    catalog: "30 Knightsbridge Road, Suite 525 Piscataway NJ 08854",
  },
];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an association evidence record.");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim())
    throw new Error("Expected a nonempty, trimmed directory field.");
  if (
    /\$\s*\d|\bUSD\b|\b(?:accounts?|reviews?|ratings?|scores?)\b|Employer of Choice|Leader in Experience/i.test(
      value,
    )
  )
    throw new Error(
      "Private, review, price or employee-award content is not directory evidence.",
    );
  return value;
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Expected directory evidence rows.");
  return value;
}

function strings(value: unknown): string[] {
  return rows(value).map(text);
}

function date(value: unknown): string {
  const day = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
    day > new Date().toISOString().slice(0, 10)
  )
    throw new Error("Expected a real, nonfuture directory check date.");
  return day;
}

function addressKey(value: string): string {
  const aliases: Record<string, string> = {
    RD: "ROAD",
    AVE: "AVENUE",
    ST: "STREET",
    DR: "DRIVE",
    STE: "SUITE",
    HWY: "HIGHWAY",
    ROUTE: "HIGHWAY",
  };
  return (value.toUpperCase().match(/[A-Z0-9]+/g) ?? [])
    .map((word) => aliases[word] ?? word)
    .join(" ");
}

function phoneKey(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function projectHomeCareAssociationDirectories(
  hchanj: unknown,
  cahc: unknown,
  decisions: unknown,
  providers: readonly CatalogOffice[],
): AssociationOffice[] {
  const catalog = new Map<string, CatalogOffice>();
  for (const provider of providers) {
    if (catalog.has(provider.id))
      throw new Error("Ambiguous catalog provider ID.");
    catalog.set(provider.id, provider);
  }
  const accepted = rows(decisions)
    .map(record)
    .filter((row) => row.status === "accepted");
  const seen = new Set<string>();
  return (["hchanj", "cahc"] as const).flatMap((association) =>
    rows(association === "hchanj" ? hchanj : cahc).map((value) => {
      const row = record(value);
      const providerId = text(row.providerId);
      const provider = catalog.get(providerId);
      if (
        !/^north-jersey-hp-hp\d{7}$/.test(providerId) ||
        !provider ||
        provider.category !== "home-care" ||
        provider.state !== "NJ"
      )
        throw new Error(
          `Expected an exact catalog NJ home-care office: ${providerId}.`,
        );
      const name = text(row.title);
      const address = text(row.address);
      const url = text(row.sourceUrl);
      const sourceUrl = new URL(url);
      if (
        sourceUrl.username ||
        sourceUrl.password ||
        row.publisher !== publishers[association]
      )
        throw new Error(
          "Expected the verified professional directory publisher.",
        );
      const checkedAt = date(row.checkedAt);
      const sourceTitle = text(row.sourceTitle);
      const listed = strings(row.services);
      const paymentOptions = strings(row.paymentOptions);
      let accreditations: string[] | undefined;
      if (association === "hchanj") {
        if (
          !url.startsWith(`${hchanjPdf}#page=`) ||
          !/^[1-9]\d*$/.test(sourceUrl.hash.slice(6)) ||
          Number(sourceUrl.hash.slice(6)) > 76
        )
          throw new Error(
            "Expected the verified HCHANJ PDF and physical page.",
          );
        const catalogAddress = `${provider.address} ${provider.city} NJ ${provider.zip}`;
        const reviewedDifference = reviewedAddressDifferences.some(
          (match) =>
            match.providerId === providerId &&
            addressKey(match.source) === addressKey(address) &&
            addressKey(match.catalog) === addressKey(catalogAddress),
        );
        if (
          addressKey(address) !== addressKey(catalogAddress) &&
          !reviewedDifference
        )
          throw new Error(`HCHANJ office identity changed for ${providerId}.`);
      } else {
        if (
          url !== "https://www.cahcusa.org/archives/" &&
          !/^https:\/\/www\.cahcusa\.org\/category\/new-jersey\/(?:[a-z]+-county\/)?(?:page\/[1-9]\d*\/)?$/.test(
            url,
          )
        )
          throw new Error(
            "Expected an official CAHC New Jersey directory page.",
          );
        accreditations = listed.map((claim) => {
          if (!acceptedClaims.has(claim))
            throw new Error("Expected a reviewed CAHC accreditation scope.");
          return claim
            .replace(/^CAHC lists /, "")
            .replace(" accreditation", "");
        });
        if (!accreditations.length || paymentOptions.length)
          throw new Error(
            "CAHC accreditation is not a service or payment claim.",
          );
        const matched = accepted.some((decision) => {
          if (
            decision.providerId !== providerId ||
            decision.reason !== "unique-city-name-primary-phone"
          )
            return false;
          const listing = record(decision.listing);
          const publishedCity = `${text(listing.city)}, NJ`;
          const matchesAddress =
            address === publishedCity ||
            (/^\d{5}$/.test(String(listing.zip)) &&
              address === `${publishedCity} ${listing.zip}`);
          if (
            listing.legalName !== name ||
            listing.sourceUrl !== url ||
            !matchesAddress ||
            JSON.stringify(
              strings(listing.scope)
                .map((scope) => scopeByLabel[scope])
                .sort(),
            ) !== JSON.stringify([...listed].sort())
          )
            return false;
          const candidates = rows(decision.candidateEvidence).map(record);
          const eligible = candidates.filter(
            (candidate) => candidate.eligible === true,
          );
          if (eligible.length !== 1) return false;
          const candidate = eligible[0];
          return (
            candidate.providerId === providerId &&
            candidate.sameCity === true &&
            candidate.comparableName === true &&
            candidate.exactPrimaryPhone === true &&
            candidate.bridgeConsistent === true &&
            candidate.state === "NJ" &&
            addressKey(text(candidate.city)) === addressKey(provider.city) &&
            addressKey(text(listing.city)) === addressKey(provider.city) &&
            addressKey(text(candidate.address)) ===
              addressKey(provider.address) &&
            /^\d{10}$/.test(phoneKey(provider.phone)) &&
            phoneKey(text(candidate.primaryPhone)) ===
              phoneKey(provider.phone) &&
            phoneKey(text(listing.phone)) === phoneKey(provider.phone)
          );
        });
        if (!matched)
          throw new Error(
            `Missing documented CAHC office match for ${providerId}.`,
          );
      }
      const key = JSON.stringify([
        association,
        providerId,
        url,
        accreditations ?? [],
      ]);
      if (seen.has(key))
        throw new Error("Duplicate association office provenance.");
      seen.add(key);
      return {
        providerId,
        office: { name, address },
        source: {
          id: `${association}-${providerId}-${digest(url).slice(0, 12)}`,
          url,
          title: sourceTitle,
          publisher: publishers[association],
          kind: "public-directory",
          checkedAt,
          publishedAt: null,
          access: association === "hchanj" ? "pdf" : "full-page",
        },
        services: association === "hchanj" ? listed : [],
        paymentOptions,
        awards: [],
        ...(accreditations ? { accreditations } : {}),
      } satisfies AssociationOffice;
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const raw = inputFiles.map((file) =>
    readFileSync(new URL(file, root), "utf8"),
  );
  const [hchanj, cahc, decisions]: unknown[] = raw.map((value) =>
    JSON.parse(value),
  );
  if (!rows(hchanj).length || !rows(cahc).length)
    throw new Error(
      "Both reviewed association inputs must be present and nonempty.",
    );
  const market = markets.find((market) => market.id === "north-jersey");
  if (!market) throw new Error("Missing raw North Jersey market.");
  const offices = projectHomeCareAssociationDirectories(
    hchanj,
    cahc,
    decisions,
    market.providers,
  );
  const output =
    JSON.stringify(
      {
        schemaVersion: 1,
        inputs: inputFiles.map((file, index) => ({
          file,
          sha256: digest(raw[index]),
        })),
        offices,
      },
      null,
      2,
    ) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(outputFile, "utf8") !== output)
      throw new Error(
        "Association directory release differs from reviewed projection.",
      );
  } else {
    writeFileSync(outputFile, output);
  }
  console.log(
    `Verified ${offices.length} association records for ${new Set(offices.map((office) => office.providerId)).size} exact home-care offices.`,
  );
}
