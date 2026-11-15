import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getMarket } from "../src/lib/markets";
import type { Provider } from "../src/lib/providers";
import type { HomeCareOfficeIdentifiers } from "../src/lib/home-care-office-identifiers";

const root = new URL("../", import.meta.url);
const networkFile = "research/north-jersey/home-care-network/verified.json";
const uhcFile = "research/north-jersey/home-care-network/uhc-verified.json";
const wellpointFile =
  "research/north-jersey/home-care-network/wellpoint-verified.json";
const wellpointPageLimits = new Map([
  [
    "https://www.provider.wellpoint.com/docs/gpp/NJ_WLP_ProviderDirectoryNortheast.pdf?v=202501172111",
    1444,
  ],
  [
    "https://www.provider.wellpoint.com/docs/gpp/NJ_WLP_ProviderDirectoryNorthwestCentral.pdf?v=202601262035",
    1462,
  ],
]);
const nppesFile =
  "research/north-jersey/home-care-nppes/verified-branch-facts.json";
const outputFile = new URL("src/data/home-care-office-identifiers.json", root);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const addressWords: Record<string, string> = {
  STREET: "ST",
  ROAD: "RD",
  AVENUE: "AVE",
  BOULEVARD: "BLVD",
  DRIVE: "DR",
  LANE: "LN",
  COURT: "CT",
  PLACE: "PL",
  PLAZA: "PLZ",
  HIGHWAY: "HWY",
  ROUTE: "RTE",
  TURNPIKE: "TPKE",
  PARKWAY: "PKWY",
  TERRACE: "TER",
  SUITE: "STE",
  FLOOR: "FL",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  FIRST: "1",
  SECOND: "2",
  THIRD: "3",
};

function street(value: string): string {
  return value
    .toUpperCase()
    .replaceAll("&", " AND ")
    .replace(/\bFL(\d+)\b/g, "FL $1")
    .replace(/\b(\d+)(?:ST|ND|RD|TH)\b/g, "$1")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) =>
      Object.hasOwn(addressWords, word) ? addressWords[word] : word,
    )
    .join(" ")
    .replace(/\b(\d+) FL\b/g, "FL $1");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an evidence record.");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim())
    throw new Error("Expected a nonempty, trimmed evidence field.");
  return value;
}

function date(value: unknown, allowMonth = false): string {
  const day = text(value);
  if (allowMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(day)) {
    date(`${day}-01`);
    return day;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
    day > new Date().toISOString().slice(0, 10)
  )
    throw new Error("Expected a real, nonfuture source date.");
  return day;
}

function validNpi(value: unknown): string {
  const npi = text(value);
  if (!/^[12]\d{9}$/.test(npi)) throw new Error("Invalid organizational NPI.");
  const digits = `80840${npi}`;
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[index]);
    if (index % 2 === 1) digit *= 2;
    sum += digit > 9 ? digit - 9 : digit;
  }
  if (sum % 10 !== 0) throw new Error("Invalid NPI check digit.");
  return npi;
}

export function projectHomeCareOfficeIdentifiers(
  network: unknown,
  nppes: unknown,
  uhc: unknown,
  providers: readonly Provider[],
  wellpoint: unknown = {},
): HomeCareOfficeIdentifiers[] {
  const catalog = new Map(
    providers
      .filter(
        (provider) =>
          provider.category === "home-care" && provider.state === "NJ",
      )
      .map((provider) => [provider.id, provider]),
  );
  const networkRows = record(network);
  const nppesRows = record(nppes);
  const uhcRows = record(uhc);
  const directories = [
    {
      rows: networkRows,
      payer: "Fidelis Care New Jersey",
      program: "NJ FamilyCare Medicaid",
      pageLimit: (url: string) =>
        /^https:\/\/www\.fideliscarenj\.com\/content\/dam\/centene\/wellcare\/nj\/pdfs\/directories\/NJ_Caid_Provider_Directory_Region_(?:1_[12]|2_[12]|3_[12]|4_2)_Eng_Spa_R\.PDF$/.test(
          url,
        )
          ? Number.MAX_SAFE_INTEGER
          : 0,
    },
    {
      rows: uhcRows,
      payer: "UnitedHealthcare Community Plan",
      program: "NJ FamilyCare Medicaid MLTSS",
      pageLimit: (url: string) =>
        /^https:\/\/www\.uhc\.com\/communityplan\/assets\/plandocuments\/providerdirectory\/NJ_MLTSS_Provider_List_by_County\.pdf$/.test(
          url,
        )
          ? 373
          : 0,
    },
    {
      rows: record(wellpoint),
      payer: "Wellpoint",
      program: "NJ FamilyCare Medicaid",
      pageLimit: (url: string) => wellpointPageLimits.get(url) ?? 0,
      sourceMonth: "2026-11",
    },
  ];
  const ids = [
    ...new Set([
      ...Object.keys(nppesRows),
      ...directories.flatMap(({ rows }) => Object.keys(rows)),
    ]),
  ].sort();
  const digits = (value: string) => value.replace(/\D/g, "");
  const city = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ids.map((providerId) => {
    const provider = catalog.get(providerId);
    if (!/^north-jersey-hp-hp\d{7}$/.test(providerId) || !provider)
      throw new Error(
        `Expected an exact runtime NJ home-care ID: ${providerId}.`,
      );
    const office: HomeCareOfficeIdentifiers = { providerId };
    for (const directory of directories) {
      if (!Object.hasOwn(directory.rows, providerId)) continue;
      const row = record(directory.rows[providerId]);
      if (
        row.evidenceType !== "historical_public_payer_directory_listing" ||
        row.payer !== directory.payer ||
        row.program !== directory.program ||
        !Array.isArray(row.listings) ||
        !row.listings.length
      )
        throw new Error(
          `Expected reviewed historical ${directory.payer} directory evidence.`,
        );
      const checkedAt = date(row.checkedDate);
      const sources = new Map<
        string,
        {
          url: string;
          asOf: string;
          physicalPage: number;
          printedPage?: string;
        }
      >();
      for (const value of row.listings) {
        const listing = record(value);
        if (
          listing.state !== "NJ" ||
          city(text(listing.city)) !== city(provider.city) ||
          text(listing.zip).slice(0, 5) !== provider.zip ||
          digits(text(listing.phone)) !== digits(provider.phone ?? "") ||
          street(text(listing.address)) !== street(provider.address)
        )
          throw new Error(
            `Directory office identity changed for ${providerId}.`,
          );
        const url = text(listing.sourceUrl);
        if (
          typeof listing.physicalPage !== "number" ||
          !Number.isSafeInteger(listing.physicalPage) ||
          listing.physicalPage < 1 ||
          listing.physicalPage > directory.pageLimit(url)
        )
          throw new Error(
            "Expected an official directory PDF and physical page.",
          );
        const asOf = date(listing.sourceDate, true);
        if (directory.sourceMonth && asOf !== directory.sourceMonth)
          throw new Error("Expected the month printed in the directory.");
        if (asOf > checkedAt)
          throw new Error("Directory date is after its check.");
        const printedPage =
          listing.printedPage == null ? undefined : text(listing.printedPage);
        if (printedPage !== undefined && !/^[1-9]\d*$/.test(printedPage))
          throw new Error("Expected a positive printed directory page.");
        const source = {
          url,
          asOf,
          physicalPage: listing.physicalPage,
          ...(printedPage === undefined ? {} : { printedPage }),
        };
        const key = JSON.stringify(source);
        sources.set(key, source);
      }
      (office.historicalDirectories ??= []).push({
        payer: text(row.payer),
        program: text(row.program),
        checkedAt,
        sources: [...sources.values()].sort(
          (a, b) =>
            a.url.localeCompare(b.url) ||
            a.asOf.localeCompare(b.asOf) ||
            a.physicalPage - b.physicalPage ||
            (a.printedPage ?? "").localeCompare(b.printedPage ?? ""),
        ),
      });
    }
    if (Object.hasOwn(nppesRows, providerId)) {
      const row = record(nppesRows[providerId]);
      const identity = Object.fromEntries(
        [
          "id",
          "name",
          "address",
          "city",
          "state",
          "zip",
          "phone",
          "locationKind",
        ]
          .sort()
          .map((key) => [key, provider[key as keyof Provider] ?? null]),
      );
      if (
        row.provider_id !== providerId ||
        row.basis !== "exact_organization_practice_address_unit_and_phone" ||
        row.nppes_status !== "A" ||
        row.roster_identity_sha256 !==
          digest(JSON.stringify(identity, null, 2) + "\n")
      )
        throw new Error(`NPPES office identity changed for ${providerId}.`);
      const npi = validNpi(row.npi);
      office.federalOrganization = {
        npi,
        legalName: text(row.legal_name),
        lastUpdated: date(row.nppes_last_updated),
        sourceUrl: `https://npiregistry.cms.hhs.gov/provider-view/${npi}`,
      };
    }
    return office;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const network = readFileSync(new URL(networkFile, root), "utf8");
  const nppes = readFileSync(new URL(nppesFile, root), "utf8");
  const uhc = readFileSync(new URL(uhcFile, root), "utf8");
  const uhcRows = record(JSON.parse(uhc));
  if (!Object.keys(uhcRows).length)
    throw new Error("Expected nonempty reviewed UHC directory evidence.");
  const wellpoint = readFileSync(new URL(wellpointFile, root), "utf8");
  const wellpointRows = record(JSON.parse(wellpoint));
  if (!Object.keys(wellpointRows).length)
    throw new Error("Expected nonempty reviewed Wellpoint directory evidence.");
  const offices = projectHomeCareOfficeIdentifiers(
    JSON.parse(network),
    JSON.parse(nppes),
    uhcRows,
    getMarket("north-jersey")!.providers,
    wellpointRows,
  );
  const output =
    JSON.stringify(
      {
        schemaVersion: 1,
        inputs: [
          { file: networkFile, sha256: digest(network) },
          { file: nppesFile, sha256: digest(nppes) },
          { file: uhcFile, sha256: digest(uhc) },
          { file: wellpointFile, sha256: digest(wellpoint) },
        ],
        offices,
      },
      null,
      2,
    ) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(outputFile, "utf8") !== output)
      throw new Error(
        "Office identifier release differs from reviewed projection.",
      );
  } else {
    writeFileSync(outputFile, output);
  }
  console.log(
    `Verified source records for ${offices.length} exact home-care offices.`,
  );
}
