import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

process.env.GIT_NO_LAZY_FETCH = "1";
process.env.GIT_OPTIONAL_LOCKS = "0";
let root = process.cwd();
const source = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const zero = /^0+$/;
const git = (...args) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
};
root = git("rev-parse", "--show-toplevel").slice(0, -1);
const checkoutEnv = { ...process.env };
for (const name of git("rev-parse", "--local-env-vars").trim().split("\n")) {
  delete checkoutEnv[name];
}
const checkoutGit = (cwd, ...args) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: checkoutEnv });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
};

const tips = new Map();
if (process.stdin.isTTY) {
  throw new Error(
    "Expected Git pre-push ref records on stdin. Run git push <remote> <refspec> instead of invoking this script directly.",
  );
}
for (const line of (await Bun.stdin.text()).split("\n").filter(Boolean)) {
  const fields = line.trim().split(/\s+/);
  if (
    fields.length !== 4 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[1]) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[3])
  ) {
    throw new Error("Expected Git pre-push ref records on stdin.");
  }
  const [, tip, , base] = fields;
  if (zero.test(tip)) continue;
  git("cat-file", "-e", tip);
  const tree = Bun.spawnSync(["git", "rev-parse", `${tip}^{tree}`], {
    cwd: root,
  });
  if (tree.exitCode !== 0) {
    console.error(`Skipping non-tree ref ${fields[0]}.`);
    continue;
  }
  const knownBase =
    !zero.test(base) &&
    Bun.spawnSync(["git", "cat-file", "-e", `${base}^{tree}`], {
      cwd: root,
    }).exitCode === 0;
  if (!zero.test(base) && !knownBase) {
    console.error(`Base ${base} unavailable locally; checking all tip source.`);
  }
  const forkPoint = zero.test(base)
    ? Bun.spawnSync(["git", "merge-base", tip, "refs/remotes/origin/HEAD"], {
        cwd: root,
      })
    : undefined;
  const diffBase = knownBase
    ? base
    : forkPoint?.exitCode === 0
      ? forkPoint.stdout.toString().trim()
      : undefined;
  const changed = diffBase
    ? git(
        "diff-tree",
        "-r",
        "--name-only",
        "-z",
        "--no-renames",
        "--no-relative",
        "--no-ext-diff",
        diffBase,
        tip,
      )
    : git("ls-tree", "-r", "--name-only", "-z", tip);
  const plan = tips.get(tip) ?? { selected: new Set(), refs: new Set() };
  plan.refs.add(fields[0]);
  for (const file of changed.split("\0")) {
    if (source.test(file)) plan.selected.add(file);
  }
  tips.set(tip, plan);
}

const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const installed = [...tips.values()].some(({ selected }) => selected.size)
  ? json(join(root, "node_modules/.package-lock.json"))
  : null;
const localLock = installed ? json(join(root, "package-lock.json")) : null;
let temporary;
const cleanup = () => {
  if (!temporary) return;
  const checkout = join(temporary, "checkout");
  if (existsSync(join(checkout, ".git"))) {
    checkoutGit(root, "worktree", "remove", "--force", checkout);
  }
  rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
};
process.on("exit", () => {
  try {
    cleanup();
  } catch (error) {
    console.error(`Could not remove isolated checkout: ${error.message}`);
    process.exitCode = 1;
  }
});
let activeChild;
let interrupted;
let killTimer;
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
]) {
  process.on(signal, () => {
    interrupted ??= code;
    process.exitCode = interrupted;
    if (!activeChild) process.exit(interrupted);
    activeChild.kill(signal);
    killTimer ??= setTimeout(() => activeChild?.kill("SIGKILL"), 1000);
    killTimer.unref();
  });
}

tipsLoop: for (const [tip, { selected, refs }] of tips) {
  if (!selected.size) continue;
  const manifest = JSON.parse(git("show", `${tip}:package.json`));
  const lock = JSON.parse(git("show", `${tip}:package-lock.json`));
  const mismatch = () => {
    throw new Error(
      `Dependencies do not match ${tip}. Run npm ci in a separate checkout of that tip; shared node_modules was not changed.`,
    );
  };
  if (
    !isDeepStrictEqual(lock, localLock) ||
    !lock.packages ||
    !installed?.packages
  ) {
    mismatch();
  }
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    if (!isDeepStrictEqual(manifest[field], lock.packages[""]?.[field])) {
      mismatch();
    }
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (!installed.packages[path] && entry.optional) continue;
    if (
      entry.link ||
      !isDeepStrictEqual(entry, installed.packages[path]) ||
      !existsSync(join(root, path, "package.json")) ||
      json(join(root, path, "package.json")).version !== entry.version
    ) {
      mismatch();
    }
  }
  for (const path of Object.keys(installed.packages)) {
    if (!lock.packages[path]) mismatch();
  }

  const files = new Set(
    git("ls-tree", "-r", "--name-only", "-z", tip).split("\0"),
  );
  const present = [...selected]
    .filter((file) => files.has(file))
    .map((file) => `./${file}`);
  const deleted = present.length !== selected.size;
  const head = Bun.spawnSync(
    ["git", "rev-parse", "--verify", "--quiet", "HEAD"],
    { cwd: root },
  );
  const inPlace =
    head.exitCode === 0 &&
    tip === head.stdout.toString().trimEnd() &&
    refs.size === 1 &&
    refs.has(git("rev-parse", "--symbolic-full-name", "HEAD").trimEnd()) &&
    !git(
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ":(top,exclude)node_modules",
    );
  let cwd = root;
  try {
    if (!inPlace) {
      temporary = mkdtempSync(join(tmpdir(), "harbor-push-"));
      cwd = join(temporary, "checkout");
      const commit = Bun.spawnSync(
        ["git", "rev-parse", "--verify", "--quiet", `${tip}^{commit}`],
        { cwd: root },
      );
      checkoutGit(
        root,
        "-c",
        "core.hooksPath=/dev/null",
        "worktree",
        "add",
        ...(commit.exitCode === 0
          ? ["--detach", "--no-checkout"]
          : ["--orphan", "-b", basename(temporary)]),
        cwd,
        ...(commit.exitCode === 0 ? [commit.stdout.toString().trimEnd()] : []),
      );
      // Reading the tree also supports tags that point directly at trees.
      checkoutGit(cwd, "read-tree", `${tip}^{tree}`);
      checkoutGit(cwd, "checkout-index", "--all");
      symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
    }
    console.log(
      `Checking ${selected.size} changed source path(s) at ${tip} ${inPlace ? "in place" : "in an isolated full-tip checkout"}.`,
    );
    const commands = [];
    if (present.length) {
      const prettier = json(join(root, "node_modules/prettier/package.json"));
      const oxlint = json(join(root, "node_modules/oxlint/package.json"));
      commands.push(
        [
          process.execPath,
          join(
            root,
            "node_modules/prettier",
            typeof prettier.bin === "string"
              ? prettier.bin
              : prettier.bin.prettier,
          ),
          "--check",
          "--",
          ...present,
        ],
        [
          process.execPath,
          join(root, "node_modules/oxlint", oxlint.bin.oxlint),
          "--format=agent",
          "--deny-warnings",
          "--",
          ...present,
        ],
      );
    }
    let roots = present;
    if (!deleted && present.length) {
      const ts = (await import("typescript")).default;
      const config = ts.getParsedCommandLineOfConfigFile(
        join(cwd, "tsconfig.json"),
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic(diagnostic) {
            throw new Error(
              ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
            );
          },
        },
      );
      if (config.errors.length) {
        throw new Error(
          config.errors
            .map((error) =>
              ts.flattenDiagnosticMessageText(error.messageText, "\n"),
            )
            .join("\n"),
        );
      }
      const projectFiles = new Set(config.fileNames);
      roots = present.filter((file) => projectFiles.has(resolve(cwd, file)));
    }
    // A deletion can break an unchanged importer, so check the project too.
    if (deleted || roots.length) {
      commands.push([
        process.execPath,
        "check",
        "--no-script",
        ...(deleted ? [] : ["--", ...roots]),
      ]);
    }
    for (const command of commands) {
      if (interrupted) break tipsLoop;
      activeChild = Bun.spawn(command, {
        cwd,
        env: checkoutEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      let exitCode;
      try {
        exitCode = await activeChild.exited;
      } finally {
        clearTimeout(killTimer);
        killTimer = undefined;
        activeChild = undefined;
      }
      if (interrupted) break tipsLoop;
      if (exitCode !== 0) process.exitCode = 1;
    }
  } finally {
    cleanup();
  }
}
if (!interrupted) {
  console.log(
    "Local gate checks formatting, lint and types. CI retains whole-tree tsc.",
  );
}
