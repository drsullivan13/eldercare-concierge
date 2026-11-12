#!/usr/bin/env -S npx tsx
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseCsv,
  validateResearchImport,
} from "../src/lib/research-pipeline/import";

import {
  legacyMarket,
  matchesProviderNamespace,
  parseMarketRegistrations,
  registeredMarket,
  type MarketRegistration,
} from "../src/lib/market-registration";

const USAGE = `Usage (from repository root):
  npx tsx scripts/import-research.ts --observations observations.csv --coverage coverage.csv
    [--catalog harbor-catalog-521.csv] [--assigned assigned-provider-ids.json]
    [--as-of 2026-11-12T23:59:59Z] [--write]

Default is dry-run: print only counts and validation issues; write nothing.
--write creates an immutable JSON staging artifact under ignored artifacts/research-imports/.
--assigned accepts legacy ID arrays or { geography: { state, cities?, zips? }, providerIds }.
Subset kit catalogs require a geographic assignment and verified location columns.
See docs/regional-research-import.md for exact matching and CSV requirements.
No database writes, publication, scoring, network requests or restricted-content storage.
`;

type Geography = { state: string; cities?: string[]; zips?: string[] };
const CATALOG_FIELDS = [
  { key: "name", columns: ["name", "provider_name"], subset: true },
  { key: "category", columns: ["category", "care_category"], subset: false },
  { key: "address", columns: ["address"], subset: true },
  { key: "city", columns: ["city"], subset: true },
  { key: "state", columns: ["state"], subset: false },
  { key: "zip", columns: ["zip", "postal_code"], subset: true },
  { key: "lat", columns: ["lat", "latitude"], subset: false },
  { key: "lng", columns: ["lng", "longitude"], subset: false },
  {
    key: "locationKind",
    columns: ["location_kind", "locationKind"],
    subset: false,
  },
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AppIdentity = Record<string, unknown> & { id: string; state: string };

function selectStateCatalog(
  legacy: unknown,
  registered: unknown,
  state: unknown,
  registrations: MarketRegistration[],
  legacyZips: unknown,
): AppIdentity[] {
  const providerIds = new Set<string>();
  const ccns = new Set<string>();
  const marketIds = new Set([legacyMarket.id]);
  if (!record(legacyZips)) throw new Error("Invalid legacy market ZIPs.");
  const zipIds = new Set(Object.keys(legacyZips));
  const catalogs = new Map<string, AppIdentity[]>();
  function providers(
    value: unknown,
    marketState: string,
    marketId: string,
  ): AppIdentity[] {
    if (!Array.isArray(value) || !value.length)
      throw new Error("Published providers must be a nonempty array.");
    return value.map((provider: unknown) => {
      if (
        !record(provider) ||
        typeof provider.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(provider.id) ||
        providerIds.has(provider.id) ||
        !matchesProviderNamespace(provider.id, marketId) ||
        provider.state !== marketState ||
        ["name", "category", "address", "city"].some(
          (key) => typeof provider[key] !== "string" || !provider[key],
        ) ||
        typeof provider.zip !== "string" ||
        !/^\d{5}$/.test(provider.zip) ||
        (provider.locationKind !== undefined &&
          (typeof provider.locationKind !== "string" ||
            !provider.locationKind)) ||
        (["lat", "lng"] as const).some((key) => {
          const coordinate = provider[key];
          return (
            coordinate !== null &&
            (typeof coordinate !== "number" ||
              !Number.isFinite(coordinate) ||
              Math.abs(coordinate) > (key === "lat" ? 90 : 180))
          );
        })
      )
        throw new Error("Invalid or colliding published provider identity.");
      providerIds.add(provider.id);
      if (provider.cms !== undefined && provider.cms !== null) {
        if (
          !record(provider.cms) ||
          typeof provider.cms.ccn !== "string" ||
          !provider.cms.ccn ||
          provider.id !== `cms-${provider.cms.ccn}` ||
          ccns.has(provider.cms.ccn)
        )
          throw new Error("Invalid or colliding published CMS identity.");
        ccns.add(provider.cms.ccn);
      }
      return provider as AppIdentity;
    });
  }
  catalogs.set(
    legacyMarket.state,
    providers(legacy, legacyMarket.state, legacyMarket.id),
  );
  if (!Array.isArray(registered))
    throw new Error("Published market registry must be an array.");
  for (const market of registered) {
    const registration = registeredMarket(
      record(market) ? market.id : undefined,
      registrations,
    );
    if (
      !record(market) ||
      !registration ||
      typeof market.id !== "string" ||
      market.state !== registration.state ||
      market.label !== registration.label ||
      market.defaultZip !== registration.defaultZip ||
      marketIds.has(market.id) ||
      typeof market.label !== "string" ||
      !market.label ||
      !record(market.meta) ||
      typeof market.meta.asOf !== "string" ||
      !market.meta.asOf ||
      !record(market.zips) ||
      typeof market.defaultZip !== "string" ||
      !Object.hasOwn(market.zips, market.defaultZip)
    )
      throw new Error("Invalid or duplicate reviewed market snapshot.");
    marketIds.add(market.id);
    for (const [zip, point] of Object.entries(market.zips)) {
      if (
        !/^\d{5}$/.test(zip) ||
        zipIds.has(zip) ||
        !record(point) ||
        typeof point.city !== "string" ||
        !point.city ||
        typeof point.lat !== "number" ||
        !Number.isFinite(point.lat) ||
        Math.abs(point.lat) > 90 ||
        typeof point.lng !== "number" ||
        !Number.isFinite(point.lng) ||
        Math.abs(point.lng) > 180
      )
        throw new Error("Invalid or ambiguous reviewed market ZIP.");
      zipIds.add(zip);
    }
    catalogs.set(market.state, [
      ...(catalogs.get(market.state) ?? []),
      ...providers(market.providers, market.state, market.id),
    ]);
  }
  if (typeof state !== "string" || !catalogs.has(state))
    throw new Error("Assignment state has no published app catalog.");
  return catalogs.get(state)!;
}

function exactIds(value: unknown, catalog: ReadonlyMap<string, unknown>) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((id) => typeof id !== "string" || !catalog.has(id)) ||
    new Set(value).size !== value.length
  )
    throw new Error("Assignment IDs must be unique, nonempty current app IDs.");
  return value as string[];
}

export function validateImportScope(input: {
  applicationCatalog: unknown;
  kitCatalogCsv?: string;
  assignment?: unknown;
}) {
  if (
    !Array.isArray(input.applicationCatalog) ||
    !input.applicationCatalog.length
  )
    throw new Error("Application catalog must be a nonempty array.");
  const catalog = new Map<string, Record<string, unknown>>();
  for (const provider of input.applicationCatalog) {
    if (
      !record(provider) ||
      typeof provider.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(provider.id) ||
      catalog.has(provider.id)
    )
      throw new Error(
        "Application catalog identities must be valid and unique.",
      );
    catalog.set(provider.id, provider);
  }
  let assignedProviderIds: string[] | undefined;
  let geography: Geography | undefined;
  if (input.assignment !== undefined) {
    if (Array.isArray(input.assignment)) {
      assignedProviderIds = exactIds(input.assignment, catalog);
    } else {
      const assignment = input.assignment;
      if (
        !record(assignment) ||
        Object.keys(assignment).some(
          (key) => !["geography", "providerIds"].includes(key),
        ) ||
        !record(assignment.geography)
      )
        throw new Error(
          "Geographic assignments require geography and providerIds.",
        );
      const geo = assignment.geography;
      if (
        Object.keys(geo).some(
          (key) => !["state", "cities", "zips"].includes(key),
        ) ||
        typeof geo.state !== "string" ||
        !/^[A-Z]{2}$/.test(geo.state)
      )
        throw new Error("Geography requires an exact two-letter state.");
      for (const key of ["cities", "zips"] as const) {
        const values = geo[key];
        if (values === undefined) continue;
        if (
          !Array.isArray(values) ||
          !values.length ||
          values.some(
            (value) =>
              typeof value !== "string" ||
              !value.trim() ||
              value !== value.trim() ||
              (key === "zips" && !/^\d{5}$/.test(value)),
          ) ||
          new Set(values).size !== values.length
        )
          throw new Error(
            "Geographic lists must contain unique exact cities or five-digit ZIPs.",
          );
      }
      geography = {
        state: geo.state,
        ...(geo.cities === undefined ? {} : { cities: geo.cities as string[] }),
        ...(geo.zips === undefined ? {} : { zips: geo.zips as string[] }),
      };
      assignedProviderIds = exactIds(assignment.providerIds, catalog);
      for (const id of assignedProviderIds) {
        const provider = catalog.get(id)!;
        if (
          provider.state !== geography.state ||
          (geography.cities &&
            !geography.cities.includes(provider.city as string)) ||
          (geography.zips && !geography.zips.includes(provider.zip as string))
        )
          throw new Error(
            "Assigned providers must match authoritative app geography.",
          );
      }
    }
  }

  let kitProviders: number | null = null;
  if (input.kitCatalogCsv !== undefined) {
    const [header = [], ...rows] = parseCsv(input.kitCatalogCsv);
    const idIndex = header.indexOf("provider_id");
    if (
      idIndex < 0 ||
      header.some((column) => !column || column !== column.trim()) ||
      new Set(header).size !== header.length ||
      !rows.length ||
      rows.some((row) => row.length !== header.length)
    )
      throw new Error("Kit catalog has invalid CSV headers or row widths.");
    const kitIds = new Set<string>();
    for (const row of rows) {
      const id = row[idIndex];
      const provider = catalog.get(id);
      if (!provider || kitIds.has(id))
        throw new Error(
          "Kit identities must be unique, nonempty current app IDs.",
        );
      kitIds.add(id);
      for (const field of CATALOG_FIELDS) {
        for (const column of field.columns) {
          const index = header.indexOf(column);
          if (index < 0) continue;
          const authoritative = provider[field.key];
          const supplied = row[index];
          const matches =
            typeof authoritative === "number"
              ? supplied.trim() !== "" &&
                Number.isFinite(Number(supplied)) &&
                Number(supplied) === authoritative
              : authoritative === null &&
                  (field.key === "lat" || field.key === "lng")
                ? supplied === ""
                : typeof authoritative === "string" &&
                  supplied === authoritative;
          if (!matches)
            throw new Error(
              "Kit identity and geography fields must match the app catalog.",
            );
        }
      }
    }
    kitProviders = kitIds.size;
    if (kitIds.size !== catalog.size) {
      if (
        !geography ||
        !assignedProviderIds ||
        assignedProviderIds.length !== kitIds.size ||
        assignedProviderIds.some((id) => !kitIds.has(id))
      )
        throw new Error(
          "Subset kit IDs must exactly match an explicit geographic assignment.",
        );
      if (
        CATALOG_FIELDS.some(
          (field) =>
            field.subset &&
            !field.columns.some((column) => header.includes(column)),
        )
      )
        throw new Error(
          "Subset kits require name, address, city and zip columns.",
        );
    }
  }
  return {
    catalogProviderIds: [...catalog.keys()],
    assignedProviderIds,
    summary: {
      applicationProviders: catalog.size,
      kitProviders,
      assignedProviders: assignedProviderIds?.length ?? null,
      geography: geography ?? null,
    },
  };
}

async function readUtf8(path: string, label: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 10 * 1024 * 1024)
    throw new Error(`${label} must be a regular file of at most 10 MiB.`);
  const bytes = await readFile(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8.`);
  }
}
async function privateDirectory(path: string) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      "Private output directories must be real directories, not symbolic links.",
    );
  await chmod(path, 0o700);
}
async function writePrivateArtifact(
  root: string,
  batchId: string,
  content: string,
) {
  const artifactRoot = join(root, "artifacts");
  const outputRoot = join(artifactRoot, "research-imports");
  const output = join(outputRoot, `${batchId}.json`);
  try {
    execFileSync(
      "git",
      ["check-ignore", "--quiet", "--", relative(root, output)],
      { cwd: root, stdio: "ignore" },
    );
  } catch {
    throw new Error(
      "Refusing to write: the staging destination must be Git-ignored and untracked.",
    );
  }
  await privateDirectory(artifactRoot);
  await privateDirectory(outputRoot);
  const temporary = join(outputRoot, `.staging-${randomUUID()}.tmp`);
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      // An atomic, non-overwriting link exposes only a complete private artifact.
      await link(temporary, output);
      return { path: relative(root, output), state: "created" };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const existing = await open(
        output,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if (
          !(await existing.stat()).isFile() ||
          (await existing.readFile("utf8")) !== content
        )
          throw new Error(
            "Refusing to replace a conflicting staging artifact.",
          );
        await existing.chmod(0o600);
        return { path: relative(root, output), state: "unchanged" };
      } finally {
        await existing.close();
      }
    }
  } finally {
    await unlink(temporary);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }
  const values = new Map<string, string>();
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      if (write) throw new Error("Do not repeat --write.");
      write = true;
      continue;
    }
    if (
      ![
        "--observations",
        "--coverage",
        "--catalog",
        "--assigned",
        "--as-of",
      ].includes(arg) ||
      values.has(arg) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error("Unknown, repeated or missing CLI option; use --help.");
    values.set(arg, args[++i]);
  }
  if (!values.get("--observations") || !values.get("--coverage"))
    throw new Error(
      "Both --observations and --coverage are required; use --help.",
    );
  const root = resolve(process.cwd());
  let catalog: unknown = JSON.parse(
    await readUtf8(
      join(root, "src/data/providers.json"),
      "Application catalog",
    ),
  );
  const assignment: unknown = values.has("--assigned")
    ? JSON.parse(
        await readUtf8(
          resolve(values.get("--assigned")!),
          "Assignment manifest",
        ),
      )
    : undefined;
  if (record(assignment)) {
    let registered: unknown = [];
    try {
      registered = JSON.parse(
        await readUtf8(
          join(root, "src/data/regional-markets.json"),
          "Published market registry",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    catalog = selectStateCatalog(
      catalog,
      registered,
      record(assignment.geography) ? assignment.geography.state : undefined,
      parseMarketRegistrations(
        JSON.parse(
          await readUtf8(
            join(root, "src/data/market-registrations.json"),
            "Market registrations",
          ),
        ),
      ),
      JSON.parse(
        await readUtf8(join(root, "src/data/ma-zips.json"), "Legacy ZIPs"),
      ),
    );
  }
  const scope = validateImportScope({
    applicationCatalog: catalog,
    kitCatalogCsv: values.has("--catalog")
      ? await readUtf8(resolve(values.get("--catalog")!), "Kit catalog")
      : undefined,
    assignment,
  });
  const result = validateResearchImport({
    observationsCsv: await readUtf8(
      resolve(values.get("--observations")!),
      "Observations CSV",
    ),
    coverageCsv: await readUtf8(
      resolve(values.get("--coverage")!),
      "Coverage CSV",
    ),
    catalogProviderIds: scope.catalogProviderIds,
    assignedProviderIds: scope.assignedProviderIds,
    asOfUtc: values.get("--as-of") ?? new Date().toISOString(),
  });
  const artifacts = [];
  if (write && result.ok && result.staging)
    artifacts.push(
      await writePrivateArtifact(
        root,
        result.staging.batchId,
        `${JSON.stringify(result.staging, null, 2)}\n`,
      ),
    );
  process.stdout.write(
    `${JSON.stringify({ ok: result.ok, dryRun: !write, counts: result.counts, scope: scope.summary, batchId: result.staging?.batchId ?? null, humanReview: result.staging ? { total: result.staging.reviewQueue.length, priority: result.staging.reviewQueue.filter((item) => item.priority === "priority").length } : null, errors: result.errors, warnings: result.warnings, artifacts }, null, 2)}\n`,
  );
  if (!result.ok) process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    // Do not echo parser/input content, raw filesystem errors or potentially sensitive paths.
    process.stderr.write(
      "Research import failed before staging. Check input paths, UTF-8 CSV format, CLI options and the ignored private output destination. Use --help for the contract.\n",
    );
    process.exitCode = 1;
  });
