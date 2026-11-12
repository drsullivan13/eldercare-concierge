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
import {
  parseCsv,
  validateResearchImport,
} from "../src/lib/research-pipeline/import";

const USAGE = `Usage (from repository root):
  npx tsx scripts/import-research.ts --observations observations.csv --coverage coverage.csv
    [--catalog harbor-catalog-521.csv] [--assigned assigned-provider-ids.json]
    [--as-of 2026-11-12T23:59:59Z] [--write]

Default is dry-run: print only counts and validation issues; write nothing.
--write creates an immutable JSON staging artifact under ignored artifacts/research-imports/.
No database writes, publication, scoring, network requests or restricted-content storage.
`;

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
  const catalog = JSON.parse(
    await readUtf8(
      join(root, "src/data/providers.json"),
      "Application catalog",
    ),
  ) as { id: string }[];
  const catalogIds = catalog.map((p) => p.id);
  if (values.has("--catalog")) {
    const rows = parseCsv(
      await readUtf8(resolve(values.get("--catalog")!), "Kit catalog"),
    );
    const header = rows.shift() ?? [],
      index = header.indexOf("provider_id");
    if (
      index < 0 ||
      new Set(header).size !== header.length ||
      rows.some((row) => row.length !== header.length)
    )
      throw new Error("Kit catalog has invalid CSV headers or row widths.");
    const kitIds = rows.map((row) => row[index]);
    if (
      new Set(kitIds).size !== kitIds.length ||
      kitIds.length !== catalogIds.length ||
      kitIds.some((id) => !catalogIds.includes(id))
    )
      throw new Error(
        "Kit catalog IDs must match the current application catalog exactly.",
      );
  }
  let assignedProviderIds: string[] | undefined;
  if (values.has("--assigned")) {
    const assigned: unknown = JSON.parse(
      await readUtf8(resolve(values.get("--assigned")!), "Assignment manifest"),
    );
    if (
      !Array.isArray(assigned) ||
      assigned.some((id) => typeof id !== "string")
    )
      throw new Error(
        "Assignment manifest must be a JSON array of exact provider IDs.",
      );
    assignedProviderIds = assigned;
  }
  const result = validateResearchImport({
    observationsCsv: await readUtf8(
      resolve(values.get("--observations")!),
      "Observations CSV",
    ),
    coverageCsv: await readUtf8(
      resolve(values.get("--coverage")!),
      "Coverage CSV",
    ),
    catalogProviderIds: catalogIds,
    assignedProviderIds,
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
    `${JSON.stringify({ ok: result.ok, dryRun: !write, counts: result.counts, batchId: result.staging?.batchId ?? null, humanReview: result.staging ? { total: result.staging.reviewQueue.length, priority: result.staging.reviewQueue.filter((item) => item.priority === "priority").length } : null, errors: result.errors, warnings: result.warnings, artifacts }, null, 2)}\n`,
  );
  if (!result.ok) process.exitCode = 1;
}
main().catch(() => {
  // Do not echo parser/input content, raw filesystem errors or potentially sensitive paths.
  process.stderr.write(
    "Research import failed before staging. Check input paths, UTF-8 CSV format, CLI options and the ignored private output destination. Use --help for the contract.\n",
  );
  process.exitCode = 1;
});
