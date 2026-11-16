import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const full = { mode: "full" };
const auditFile =
  /^docs\/ci-audit\/(README\.md|jobs\.csv|steps\.csv|runs\.csv)$/;
const testFiles = {
  unit: /^tests\/[a-z0-9-]+\.test\.ts$/,
  browser: /^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/,
};

function select() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return full;
  const { pull_request: pr, repository } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  if (
    ["main", repository.default_branch].includes(pr.base.ref) ||
    pr.head.repo?.full_name !== repository.full_name
  )
    return full;

  // Compare the base to the actual merge tree checked out by Actions.
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  if (
    git("rev-parse", "HEAD^1").trim() !== pr.base.sha ||
    git("rev-parse", "HEAD^2").trim() !== pr.head.sha
  )
    return full;
  const diff = git(
    "diff",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    "-z",
    "HEAD^1",
    "HEAD",
  );
  if (!diff) return full;
  const fields = diff.slice(0, -1).split("\0");
  const plan = { mode: "focused", unit: [], browser: [] };
  for (let i = 0; i < fields.length; i += 2) {
    const [status, path] = fields.slice(i, i + 2);
    // New entrypoints, deletions, mode changes and symlinks use full verification.
    if (!/^:100644 100644 [a-f0-9]+ [a-f0-9]+ M$/.test(status)) return full;
    if (auditFile.test(path)) continue;
    const lane = Object.keys(testFiles).find((key) =>
      testFiles[key].test(path),
    );
    if (!lane) return full;
    // Shared helpers and test entrypoints imported by other modules need both suites.
    const stem = basename(path, ".ts");
    for (const ref of ["HEAD^1", "HEAD"]) {
      if (/\bexport\b/.test(git("show", ref + ":" + path))) return full;
      const refs = spawnSync("git", [
        "grep",
        "-I",
        "-q",
        "-F",
        "-e",
        stem,
        ref,
        "--",
        "*.ts",
        "*.tsx",
        "*.js",
        "*.mjs",
        "*.cjs",
        "*.py",
        "*.sh",
        ":(exclude)" + path,
      ]);
      if (refs.status !== 1) return full;
    }
    plan[lane].push(path);
  }
  return plan;
}

if (process.argv[2] === "plan") {
  let plan = full;
  try {
    plan = select();
  } catch (error) {
    console.warn(
      "Using full verification because the diff could not be classified.",
      error.message,
    );
  }
  const output = (name, value) =>
    appendFileSync(process.env.GITHUB_OUTPUT, name + "=" + value + "\n");
  output("plan", JSON.stringify(plan));
  for (const lane of Object.keys(testFiles))
    output(lane, plan.mode === "full" || plan[lane].length > 0);
} else {
  const lane = process.argv[2];
  if (!Object.hasOwn(testFiles, lane)) throw new Error("Unknown test lane");
  const plan = JSON.parse(process.env.TEST_PLAN);
  let command;
  if (plan.mode === "full") {
    command = lane === "unit" ? ["npm", "test"] : ["npm", "run", "test:e2e"];
  } else {
    const paths = plan[lane];
    if (
      plan.mode !== "focused" ||
      !Array.isArray(paths) ||
      !paths.length ||
      !paths.every((path) => testFiles[lane].test(path))
    )
      throw new Error("Invalid test plan");
    command =
      lane === "unit"
        ? ["node_modules/.bin/tsx", "--test", ...paths]
        : [
            "node_modules/.bin/playwright",
            "test",
            ...paths.map(
              (path) => "^" + resolve(path).replaceAll(".", "\\.") + "$",
            ),
          ];
  }
  const [program, ...args] = command;
  const result = spawnSync(program, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
