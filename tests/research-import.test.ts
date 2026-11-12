import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  OBSERVATION_COLUMNS,
  COVERAGE_COLUMNS,
  parseCsv,
  validateResearchImport,
  type ResearchImportResult,
} from "../src/lib/research-pipeline/import";

// Entirely synthetic research: these fixtures make no claims about actual providers or people.
const now = "2026-11-12T18:00:00Z";
const provider = "fixture-home";
const second = "fixture-campus";
function csv(columns: readonly string[], rows: Record<string, string>[]) {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return (
    [
      columns.join(","),
      ...rows.map((row) =>
        columns.map((column) => cell(row[column] ?? "")).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
function observation(overrides: Record<string, string> = {}) {
  return {
    observation_id: "fb-001",
    run_id: "pilot-2026-11-12",
    provider_id: provider,
    candidate_provider_name: "",
    match_status: "exact",
    match_reason: "The post names the exact fixture location and care unit.",
    source_url:
      "https://www.facebook.com/story.php?story_fbid=123&id=456&comment_id=789",
    thread_url: "https://www.facebook.com/story.php?story_fbid=123&id=456",
    source_visibility: "public",
    retrieved_at_utc: "2026-11-12T17:00:00Z",
    posted_at: "2026-11-01",
    experience_period: "last spring",
    relationship: "family",
    account_type: "firsthand",
    care_level: "unknown",
    experience_stage: "previous_care",
    themes: '["communication","dining"]',
    sentiment: "mixed",
    summary:
      "The writer reports helpful communication and mixed opinions about meals.",
    supporting_public_excerpt: "Helpful communication",
    concern_type: "service",
    duplicate_of: "",
    independence_notes: "independence unestablished",
    use_status: "internal_review_pending",
    needs_human_review: "false",
    ...overrides,
  };
}
function coverage(overrides: Record<string, string> = {}) {
  return {
    run_id: "pilot-2026-11-12",
    provider_id: provider,
    searched_at_utc: "2026-11-12T17:30:00Z",
    queries_used: '["Fixture Home town experiences"]',
    sources_checked: '["Public location page and public search results"]',
    status: "evidence_found",
    observations_found: "1",
    access_limits: "",
    coverage_notes: "Selected public results, not an exhaustive history.",
    ...overrides,
  };
}
function validate(
  obs = [observation()],
  cover = [coverage()],
  extras: Partial<Parameters<typeof validateResearchImport>[0]> = {},
) {
  return validateResearchImport({
    observationsCsv: csv(OBSERVATION_COLUMNS, obs),
    coverageCsv: csv(COVERAGE_COLUMNS, cover),
    catalogProviderIds: [provider, second],
    asOfUtc: now,
    assignedProviderIds: [...new Set(cover.map((row) => row.provider_id))],
    ...extras,
  });
}
function hasError(result: ResearchImportResult, code: string) {
  assert.equal(result.ok, false);
  assert.equal(result.staging, null);
  assert.ok(
    result.errors.some((issue) => issue.code === code),
    JSON.stringify(result.errors),
  );
}

test("strict CSV accepts BOM, quoted commas, escaped quotes and embedded CRLF without evaluating content", () => {
  assert.deepEqual(
    parseCsv('\uFEFFa,b\r\n"one, two","he said ""yes""\r\nthen left"\r\n'),
    [
      ["a", "b"],
      ["one, two", 'he said "yes"\nthen left'],
    ],
  );
  for (const invalid of [
    'a,b\n"unclosed,b',
    'a,b\nx"y,z',
    'a,b\n"x"junk,z',
    "a,b\rx,y",
    "a,b\nx,\u0000",
  ])
    assert.throws(() => parseCsv(invalid));
});

test("public observations become review-only staging with deterministic IDs and no verification claims", () => {
  const first = validate();
  const again = validate();
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.deepEqual(first.staging, again.staging);
  const row = first.staging!.observations[0];
  assert.equal(row.providerId, provider);
  assert.equal(row.publishable, false);
  assert.equal(row.scoreEligible, false);
  assert.equal(row.needsHumanReview, true);
  assert.equal(row.reportedNeedsHumanReview, false);
  assert.equal(
    row.relationshipVerification,
    "self-described-or-unknown-not-independently-verified",
  );
  assert.equal(first.staging!.reviewQueue.length, 1);
  const rerun = validate(
    [
      observation({
        run_id: "pilot-rerun",
        observation_id: "fb-099",
        retrieved_at_utc: "2026-11-12T17:45:00Z",
      }),
    ],
    [coverage({ run_id: "pilot-rerun" })],
  );
  assert.equal(rerun.staging!.observations[0].id, row.id);
});

test("source edits retain their source key and tracking URLs do not invent independent observations", () => {
  const first = validate().staging!.observations[0];
  const tracked = validate([
    observation({
      source_url: observation().source_url + "&utm_source=copy&fbclid=tracking",
    }),
  ]).staging!.observations[0];
  assert.equal(first.id, tracked.id);
  const edited = validate([
    observation({
      summary:
        "The writer updated the account to describe a different experience.",
    }),
  ]).staging!.observations[0];
  assert.equal(first.sourceKey, edited.sourceKey);
  assert.notEqual(first.id, edited.id);
  const otherComment = validate([
    observation({ source_url: observation().source_url.replace("789", "790") }),
  ]).staging!.observations[0];
  assert.notEqual(first.sourceKey, otherComment.sourceKey);
});

test("headers, unknown enums, exact catalog IDs and field bounds fail closed", () => {
  hasError(
    validate(undefined, undefined, {
      observationsCsv: "observation_id,observation_id\n1,2\n",
    }),
    "headers_invalid",
  );
  hasError(
    validate([observation({ provider_id: "not-in-catalog" })]),
    "provider_invalid",
  );
  hasError(
    validate([observation({ relationship: "verified_resident" })]),
    "enum_invalid",
  );
  hasError(
    validate([observation({ summary: "x".repeat(1501) })]),
    "text_invalid",
  );
  hasError(
    validate([observation({ themes: '["invented_theme"]' })]),
    "array_invalid",
  );
  hasError(
    validate([observation({ themes: '["dining","dining"]' })]),
    "array_invalid",
  );
});

test("restricted and reuse-restricted content is rejected without payload or excerpts in diagnostic output", () => {
  for (const overrides of [
    { source_visibility: "private_authorized" },
    { use_status: "restricted_no_publication" },
  ] as Record<string, string>[]) {
    const result = validate([
      observation({
        ...overrides,
        summary: "SECRET_PRIVATE_CONTENT",
        supporting_public_excerpt: "SECRET_PRIVATE_QUOTE",
      }),
    ]);
    hasError(result, "restricted_rejected");
    assert.equal(result.counts.restrictedRowsRejected, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_PRIVATE/);
  }
});

test("serious allegations and suspicious safety language enter priority human review without becoming findings", () => {
  for (const overrides of [
    { concern_type: "safety_allegation" },
    {
      concern_type: "none",
      summary:
        "The writer alleges theft but the event is not independently established.",
    },
  ] as Record<string, string>[]) {
    const result = validate([observation(overrides)]);
    assert.equal(result.ok, true);
    assert.equal(result.staging!.reviewQueue[0].priority, "priority");
    assert.equal(result.staging!.observations[0].publishable, false);
    assert.ok(result.warnings.some((w) => w.code === "review_escalated"));
  }
});

test("unresolved identities and missing links remain explicit human-review candidates rather than forced matches", () => {
  const result = validate(
    [
      observation({
        provider_id: "",
        candidate_provider_name: "Possible Fixture Home",
        match_status: "probable",
        source_url: "",
        thread_url: "",
        supporting_public_excerpt: "",
      }),
    ],
    [coverage({ status: "ambiguous_only" })],
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const row = result.staging!.observations[0];
  assert.equal(row.providerId, null);
  assert.equal(row.sourceUrl, null);
  assert.ok(row.reviewReasons.includes("ambiguous-provider-match"));
  assert.ok(row.reviewReasons.includes("missing-source-permalink"));
  hasError(
    validate([observation({ match_status: "probable" })]),
    "ambiguous_assignment",
  );
  hasError(
    validate([observation({ source_url: "", thread_url: "" })]),
    "excerpt_unlinked",
  );
});

test("date validation separates retrieval, post and approximate experience periods; unsafe URLs fail", () => {
  for (const change of [
    { retrieved_at_utc: "2026-02-30T17:00:00Z" },
    { retrieved_at_utc: "2026-11-12T25:00:00Z" },
    { retrieved_at_utc: "2026-11-13T00:00:00Z" },
    { retrieved_at_utc: "2026-11-12T17:00:00-05:00" },
    { posted_at: "2026-11-13" },
  ] as Record<string, string>[])
    hasError(validate([observation(change)]), "date_invalid");
  assert.equal(
    validate([
      observation({ posted_at: "", experience_period: "about five years ago" }),
    ]).ok,
    true,
  );
  for (const url of [
    "javascript:alert(1)",
    "https://name:secret@facebook.com/post/1",
    "http://127.0.0.1/post",
    "http://localhost/post",
    "https://facebook.com/a b",
  ])
    hasError(validate([observation({ source_url: url })]), "url_invalid");
});

test("duplicate local IDs/content, missing duplicate targets and cycles are rejected; known copies are linked", () => {
  hasError(
    validate(
      [observation(), observation()],
      [coverage({ observations_found: "2" })],
    ),
    "duplicate_input_id",
  );
  hasError(
    validate(
      [observation(), observation({ observation_id: "fb-002" })],
      [coverage({ observations_found: "2" })],
    ),
    "duplicate_content",
  );
  hasError(
    validate([observation({ duplicate_of: "fb-999" })]),
    "duplicate_target_missing",
  );
  hasError(
    validate([observation({ duplicate_of: "fb-001" })]),
    "duplicate_cycle",
  );
  const two = observation({
    observation_id: "fb-002",
    source_url: "https://www.facebook.com/posts/222",
    duplicate_of: "fb-001",
  });
  const valid = validate(
    [observation(), two],
    [coverage({ observations_found: "2" })],
  );
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  const one = valid.staging!.observations.find(
    (o) => o.inputObservationId === "fb-001",
  )!;
  const copy = valid.staging!.observations.find(
    (o) => o.inputObservationId === "fb-002",
  )!;
  assert.equal(copy.duplicateOf, one.id);
  assert.ok(copy.duplicateCandidateIds.includes(one.id));
  assert.ok(
    valid.staging!.duplicateGroups.some(
      (group) => group.reason === "shared-thread",
    ),
  );
});

test("25-word quotation budget applies across a shared thread, not independently to every comment", () => {
  const excerpt = Array(13).fill("word").join(" ");
  const secondRow = observation({
    observation_id: "fb-002",
    source_url: observation().source_url.replace("789", "790"),
    summary: "A different selected account.",
    supporting_public_excerpt: excerpt,
  });
  hasError(
    validate(
      [observation({ supporting_public_excerpt: excerpt }), secondRow],
      [coverage({ observations_found: "2" })],
    ),
    "quote_budget",
  );
});

test("coverage preserves partial, no-result, restricted and not-searched states without inventing observations", () => {
  for (const status of [
    "searched_no_relevant_result",
    "access_restricted",
    "partial",
    "ambiguous_only",
  ]) {
    const result = validate(
      [],
      [
        coverage({
          status,
          observations_found: "0",
          access_limits:
            status === "partial"
              ? "Interrupted after the first query."
              : status === "access_restricted"
                ? "Private group not accessed or copied."
                : "",
        }),
      ],
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.staging!.coverage[0].status, status);
    assert.equal(result.staging!.observations.length, 0);
  }
  assert.equal(
    validate(
      [],
      [
        coverage({
          status: "not_searched",
          observations_found: "0",
          searched_at_utc: "",
          queries_used: "[]",
          sources_checked: "[]",
        }),
      ],
    ).ok,
    true,
  );
  hasError(
    validate([], [coverage({ status: "partial", observations_found: "0" })]),
    "limitation_missing",
  );
  hasError(
    validate(
      [observation()],
      [
        coverage({
          status: "searched_no_relevant_result",
          observations_found: "0",
        }),
      ],
    ),
    "status_contradiction",
  );
  hasError(
    validate([], [coverage({ observations_found: "1" })]),
    "count_mismatch",
  );
  hasError(
    validate(undefined, undefined, { assignedProviderIds: [provider, second] }),
    "assignment_mismatch",
  );
});

test("JSON staging preserves formula-like text as data and never emits spreadsheet CSV", () => {
  const text = '=HYPERLINK("https://example.org","synthetic text")';
  const result = validate([observation({ summary: text })]);
  assert.equal(result.ok, true);
  assert.equal(result.staging!.observations[0].summary, text);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result.staging)));
});

const script = resolve("scripts/import-research.ts");
const tsx = resolve("node_modules/.bin/tsx");
function cliFixture() {
  const root = mkdtempSync(join(tmpdir(), "harbor-import-test-"));
  mkdirSync(join(root, "src/data"), { recursive: true });
  writeFileSync(
    join(root, "src/data/providers.json"),
    JSON.stringify([{ id: provider }, { id: second }]),
  );
  writeFileSync(join(root, ".gitignore"), "/artifacts/\n");
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0);
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [observation()]),
  );
  writeFileSync(
    join(root, "coverage.csv"),
    csv(COVERAGE_COLUMNS, [coverage()]),
  );
  const run = (extra: string[] = []) =>
    spawnSync(
      tsx,
      [
        script,
        "--observations",
        "observations.csv",
        "--coverage",
        "coverage.csv",
        "--as-of",
        now,
        ...extra,
      ],
      { cwd: root, encoding: "utf8" },
    );
  return { root, run };
}

test("CLI dry-run writes nothing; explicit write is private, ignored and idempotent", (t) => {
  const { root, run } = cliFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).dryRun, true);
  assert.equal(existsSync(join(root, "artifacts")), false);
  const written = run(["--write"]);
  assert.equal(written.status, 0, written.stderr);
  const result = JSON.parse(written.stdout),
    output = join(root, result.artifacts[0].path);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(
    statSync(join(root, "artifacts/research-imports")).mode & 0o777,
    0o700,
  );
  assert.equal(
    JSON.parse(readFileSync(output, "utf8")).publicationState,
    "internal_review_pending",
  );
  assert.equal(
    JSON.parse(run(["--write"]).stdout).artifacts[0].state,
    "unchanged",
  );
});

test("CLI refuses invalid/restricted writes, symlink destinations and unignored output", (t) => {
  const { root, run } = cliFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [
      observation({
        source_visibility: "private_authorized",
        summary: "SECRET_PRIVATE_CONTENT",
      }),
    ]),
  );
  const denied = run(["--write"]);
  assert.equal(denied.status, 1);
  assert.doesNotMatch(denied.stdout + denied.stderr, /SECRET_PRIVATE_CONTENT/);
  assert.equal(existsSync(join(root, "artifacts")), false);
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [observation()]),
  );
  mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(root, "artifacts"));
  assert.equal(run(["--write"]).status, 1);
  rmSync(join(root, "artifacts"));
  writeFileSync(join(root, ".gitignore"), "");
  assert.equal(run(["--write"]).status, 1);
  assert.equal(existsSync(join(root, "artifacts")), false);
});
