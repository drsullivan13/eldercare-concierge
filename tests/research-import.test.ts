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
import marketRegistrations from "../src/data/market-registrations.json";
import appCatalog from "../src/data/providers.json";
import { validateImportScope } from "../scripts/import-research";
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
function cliFixture(
  catalog: readonly { id: string }[] = [{ id: provider }, { id: second }],
) {
  const root = mkdtempSync(join(tmpdir(), "harbor-import-test-"));
  mkdirSync(join(root, "src/data"), { recursive: true });
  writeFileSync(join(root, "src/data/providers.json"), JSON.stringify(catalog));
  writeFileSync(
    join(root, "src/data/market-registrations.json"),
    JSON.stringify(marketRegistrations),
  );
  writeFileSync(
    join(root, "src/data/ma-zips.json"),
    JSON.stringify({
      "02459": { city: "Newton Center", lat: 42.31, lng: -71.19 },
    }),
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

const regionalIds = ["ma-alr-adelaide-of-newton-centre", "mgb-home-care"];
const regionalProviders = regionalIds.map((id) => {
  const row = appCatalog.find((provider) => provider.id === id);
  assert.ok(row);
  return row;
});
const regionalAssignment = {
  geography: { state: "MA", cities: ["Newton"], zips: ["02459"] },
  providerIds: regionalIds,
};
const kitColumns = [
  "provider_id",
  "name",
  "care_category",
  "address",
  "city",
  "state",
  "zip",
  "lat",
  "lng",
];
function kitRow(
  provider: Pick<
    (typeof appCatalog)[number],
    | "id"
    | "name"
    | "category"
    | "address"
    | "city"
    | "state"
    | "zip"
    | "lat"
    | "lng"
  >,
) {
  return {
    provider_id: provider.id,
    name: provider.name,
    care_category: provider.category,
    address: provider.address,
    city: provider.city,
    state: provider.state,
    zip: provider.zip,
    lat: String(provider.lat ?? ""),
    lng: String(provider.lng ?? ""),
  };
}
function notSearched(id: string) {
  return coverage({
    provider_id: id,
    status: "not_searched",
    observations_found: "0",
    searched_at_utc: "",
    queries_used: "[]",
    sources_checked: "[]",
  });
}
function regionalFixture() {
  const fixture = cliFixture(appCatalog);
  const { root, run } = fixture;
  const rows = regionalProviders.map(kitRow);
  const saveKit = (updated = rows, columns = kitColumns) =>
    writeFileSync(join(root, "kit.csv"), csv(columns, updated));
  const saveAssignment = (assignment: unknown = regionalAssignment) =>
    writeFileSync(join(root, "assigned.json"), JSON.stringify(assignment));
  saveKit();
  saveAssignment();
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [
      observation({
        provider_id: regionalIds[0],
        summary: "Synthetic importer fixture, not actual provider research.",
        supporting_public_excerpt: "",
      }),
    ]),
  );
  writeFileSync(
    join(root, "coverage.csv"),
    csv(COVERAGE_COLUMNS, [
      coverage({ provider_id: regionalIds[0] }),
      notSearched(regionalIds[1]),
    ]),
  );
  const scopedRun = (extra: string[] = []) =>
    run(["--catalog", "kit.csv", "--assigned", "assigned.json", ...extra]);
  return { ...fixture, rows, saveKit, saveAssignment, scopedRun };
}

function njSnapshot() {
  return {
    id: "north-jersey",
    label: "North Jersey",
    state: "NJ",
    defaultZip: "07960",
    zips: {
      "07102": { city: "Newark", lat: 40.7, lng: -74.1 },
      "07960": { city: "Morristown", lat: 40.79, lng: -74.48 },
    },
    meta: { asOf: "2026-11-12" },
    providers: [
      "north-jersey-synthetic-published",
      "north-jersey-synthetic-unassigned",
    ].map((id) => ({
      id,
      name: `Synthetic ${id}`,
      category: "home-care",
      address: "1 Synthetic Road",
      city: "Newark",
      state: "NJ",
      zip: "07102",
      lat: null,
      lng: null,
    })),
  };
}

test("CLI selects published NJ authority and rejects unpublished IDs, forged states and unassigned observations", (t) => {
  const { root, saveKit, saveAssignment, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = njSnapshot();
  const nj = snapshot.providers[0];
  writeFileSync(
    join(root, "src/data/regional-markets.json"),
    JSON.stringify([snapshot]),
  );
  const assign = (id = nj.id, state = "NJ") =>
    saveAssignment({ geography: { state }, providerIds: [id] });
  assign();
  saveKit([kitRow(nj)]);
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [observation({ provider_id: nj.id })]),
  );
  writeFileSync(
    join(root, "coverage.csv"),
    csv(COVERAGE_COLUMNS, [coverage({ provider_id: nj.id })]),
  );
  const accepted = scopedRun();
  assert.equal(accepted.status, 0, accepted.stderr);
  const report = JSON.parse(accepted.stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.counts.catalogProviders, 2);
  assert.equal(report.scope.applicationProviders, 2);
  assert.equal(report.scope.kitProviders, 1);
  assert.equal(report.counts.inputObservations, 1);
  for (const id of ["unknown", "synthetic-nj-unpublished"]) {
    assign(id);
    saveKit([{ ...kitRow(nj), provider_id: id }]);
    assert.equal(scopedRun().status, 1, id);
  }
  assign(nj.id, "MA");
  saveKit([{ ...kitRow(nj), state: "MA" }]);
  assert.equal(scopedRun().status, 1);
  assign();
  saveKit([{ ...kitRow(nj), state: "MA" }]);
  assert.equal(scopedRun().status, 1);
  for (const field of ["lat", "lng"]) {
    saveKit([{ ...kitRow(nj), [field]: "0" }]);
    assert.equal(scopedRun().status, 1, field);
  }
  saveKit([kitRow(nj)]);
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [
      observation({ provider_id: snapshot.providers[1].id }),
    ]),
  );
  const outside = scopedRun();
  assert.equal(outside.status, 1);
  assert.equal(JSON.parse(outside.stdout).counts.inputObservations, 1);
  assert.deepEqual(JSON.parse(outside.stdout).artifacts, []);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI fails closed for absent or malformed published NJ registries", (t) => {
  const { root, saveKit, saveAssignment, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = njSnapshot();
  const nj = snapshot.providers[0];
  saveAssignment({ geography: { state: "NJ" }, providerIds: [nj.id] });
  saveKit([kitRow(nj)]);
  writeFileSync(join(root, "observations.csv"), csv(OBSERVATION_COLUMNS, []));
  writeFileSync(
    join(root, "coverage.csv"),
    csv(COVERAGE_COLUMNS, [notSearched(nj.id)]),
  );
  assert.equal(scopedRun().status, 1);
  for (const registry of [
    null,
    {},
    [null],
    [{ ...snapshot, id: "unregistered-market" }],
    [{ ...snapshot, state: "MA" }],
    [snapshot, snapshot],
    [{ ...snapshot, meta: {} }],
    [{ ...snapshot, zips: {} }],
    [
      {
        ...snapshot,
        zips: { "07102": { city: "Newark", lat: 100, lng: -74.1 } },
      },
    ],
    [{ ...snapshot, providers: {} }],
    [{ ...snapshot, providers: [{ ...nj, state: "MA" }] }],
    [{ ...snapshot, providers: [{ ...nj, id: appCatalog[0].id }] }],
    [{ ...snapshot, providers: [nj, nj] }],
    [{ ...snapshot, providers: [{ ...nj, id: "" }] }],
    [{ ...snapshot, providers: [{ ...nj, zip: 7102 }] }],
    [{ ...snapshot, providers: [{ ...nj, lat: "40.7" }] }],
    [{ ...snapshot, providers: [{ ...nj, cms: { ccn: "315000" } }] }],
  ]) {
    writeFileSync(
      join(root, "src/data/regional-markets.json"),
      JSON.stringify(registry),
    );
    assert.equal(scopedRun().status, 1, JSON.stringify(registry));
    saveAssignment();
    saveKit();
    writeFileSync(
      join(root, "coverage.csv"),
      csv(COVERAGE_COLUMNS, regionalIds.map(notSearched)),
    );
    assert.equal(
      scopedRun().status,
      1,
      "Malformed registry cannot fall back to MA.",
    );
    saveAssignment({ geography: { state: "NJ" }, providerIds: [nj.id] });
    saveKit([kitRow(nj)]);
    writeFileSync(
      join(root, "coverage.csv"),
      csv(COVERAGE_COLUMNS, [notSearched(nj.id)]),
    );
  }
  writeFileSync(join(root, "src/data/regional-markets.json"), "[");
  assert.equal(scopedRun().status, 1);
  saveAssignment();
  saveKit();
  writeFileSync(
    join(root, "coverage.csv"),
    csv(COVERAGE_COLUMNS, regionalIds.map(notSearched)),
  );
  assert.equal(scopedRun().status, 1);
  writeFileSync(
    join(root, "src/data/regional-markets.json"),
    JSON.stringify([snapshot]),
  );
  assert.equal(scopedRun().status, 0);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("scope validation uses authoritative geography beyond MA and intersects city and ZIP selectors", () => {
  const nj = {
    id: "synthetic-nj",
    name: "Synthetic NJ",
    category: "home-care",
    address: "1 Synthetic Road",
    city: "Newark",
    state: "NJ",
    zip: "07102",
    lat: 40.7,
    lng: -74.1,
  };
  const applicationCatalog = [...appCatalog, nj];
  const input = {
    applicationCatalog,
    kitCatalogCsv: csv(kitColumns, [kitRow(nj)]),
    assignment: {
      geography: { state: "NJ", cities: ["Newark"], zips: ["07102"] },
      providerIds: [nj.id],
    },
  };
  assert.deepEqual(validateImportScope(input).assignedProviderIds, [nj.id]);
  for (const geography of [
    { state: "MA" },
    { state: "NJ", cities: ["Newton"] },
    { state: "NJ", cities: ["Newark"], zips: ["02459"] },
  ])
    assert.throws(() =>
      validateImportScope({
        ...input,
        assignment: { geography, providerIds: [nj.id] },
      }),
    );
  const before = JSON.stringify(input);
  validateImportScope(input);
  assert.equal(JSON.stringify(input), before);
});

test("scope validation rejects invalid authoritative catalog identities", () => {
  for (const applicationCatalog of [
    [],
    null,
    {},
    [{ id: "" }],
    [{ id: " " }],
    [{ id: 123 }],
    [{ id: provider }, { id: provider }],
  ])
    assert.throws(() => validateImportScope({ applicationCatalog }));
});

test("CLI default regional dry-run verifies two current Newton IDs and writes nothing", (t) => {
  const { root, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = scopedRun();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.counts, {
    inputObservations: 1,
    coverageRows: 2,
    restrictedRowsRejected: 0,
    catalogProviders: 521,
  });
  assert.deepEqual(report.scope, {
    applicationProviders: 521,
    kitProviders: 2,
    assignedProviders: 2,
    geography: regionalAssignment.geography,
  });
  assert.deepEqual(report.artifacts, []);
  assert.equal(existsSync(join(root, "artifacts")), false);
  assert.equal(
    report.warnings.some(
      (issue: { code: string }) => issue.code === "assignment_unchecked",
    ),
    false,
  );
});

test("CLI regional writes remain private, review-only and idempotent", (t) => {
  const { root, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const written = scopedRun(["--write"]);
  assert.equal(written.status, 0, written.stderr);
  const path = join(root, JSON.parse(written.stdout).artifacts[0].path);
  const staging = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(staging.publicationState, "internal_review_pending");
  assert.equal(staging.observations.length, 1);
  assert.equal(staging.observations[0].publishable, false);
  assert.equal(staging.observations[0].scoreEligible, false);
  assert.deepEqual(
    staging.coverage
      .map((row: { providerId: string }) => row.providerId)
      .sort(),
    [...regionalIds].sort(),
  );
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(
    statSync(join(root, "artifacts/research-imports")).mode & 0o777,
    0o700,
  );
  assert.equal(
    JSON.parse(scopedRun(["--write"]).stdout).artifacts[0].state,
    "unchanged",
  );
});

test("CLI accepts checklist location columns without state and checks every supplied alias", (t) => {
  const { root, saveKit, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const columns = [
    "provider_id",
    "provider_name",
    "care_category",
    "address",
    "city",
    "postal_code",
    "latitude",
    "longitude",
  ];
  const rows = regionalProviders.map((provider) => ({
    provider_id: provider.id,
    provider_name: provider.name,
    care_category: provider.category,
    address: provider.address,
    city: provider.city,
    postal_code: provider.zip,
    latitude: String(provider.lat),
    longitude: String(provider.lng),
  }));
  writeFileSync(join(root, "kit.csv"), csv(columns, rows));
  assert.equal(scopedRun().status, 0);
  for (const field of [
    "provider_name",
    "postal_code",
    "latitude",
    "longitude",
  ]) {
    writeFileSync(
      join(root, "kit.csv"),
      csv(
        columns,
        rows.map((row, i) => (i === 0 ? { ...row, [field]: "FORGED" } : row)),
      ),
    );
    assert.equal(scopedRun(["--write"]).status, 1, field);
  }
  saveKit(regionalProviders.map(kitRow), [
    "provider_id",
    "name",
    "care_category",
    "address",
    "city",
    "zip",
  ]);
  assert.equal(scopedRun().status, 0);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI retains full-catalog ID-only kits, legacy assignments and callers without optional flags", (t) => {
  const { root, run, saveAssignment } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "src/data/regional-markets.json"),
    JSON.stringify([njSnapshot()]),
  );
  writeFileSync(
    join(root, "all.csv"),
    csv(
      ["provider_id"],
      appCatalog.map((row) => ({ provider_id: row.id })),
    ),
  );
  saveAssignment(regionalIds);
  for (const args of [
    [],
    ["--catalog", "all.csv"],
    ["--catalog", "all.csv", "--assigned", "assigned.json"],
    ["--assigned", "assigned.json"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).counts.catalogProviders, 521);
    assert.equal(JSON.parse(result.stdout).dryRun, true);
  }
  saveAssignment([njSnapshot().providers[0].id]);
  assert.equal(run(["--assigned", "assigned.json"]).status, 1);
  writeFileSync(
    join(root, "all.csv"),
    csv(
      ["provider_id"],
      [
        ...appCatalog.map((row) => ({ provider_id: row.id })),
        { provider_id: njSnapshot().providers[0].id },
      ],
    ),
  );
  assert.equal(run(["--catalog", "all.csv"]).status, 1);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI accepts a complete Massachusetts assignment with 521 explicit not-searched rows", (t) => {
  const { root, run, saveAssignment } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  saveAssignment({
    geography: { state: "MA" },
    providerIds: appCatalog.map((row) => row.id),
  });
  writeFileSync(join(root, "observations.csv"), csv(OBSERVATION_COLUMNS, []));
  writeFileSync(
    join(root, "coverage.csv"),
    csv(
      COVERAGE_COLUMNS,
      appCatalog.map((row) => notSearched(row.id)),
    ),
  );
  const result = run(["--assigned", "assigned.json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).counts.coverageRows, 521);
  assert.equal(JSON.parse(result.stdout).scope.assignedProviders, 521);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI rejects subset kits without a geographic assignment or verified identity columns", (t) => {
  const { root, run, saveAssignment, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(["--catalog", "kit.csv", "--write"]).status, 1);
  saveAssignment(regionalIds);
  assert.equal(scopedRun(["--write"]).status, 1);
  saveAssignment();
  for (const missing of ["name", "address", "city", "zip"]) {
    const columns = kitColumns.filter((column) => column !== missing);
    writeFileSync(
      join(root, "kit.csv"),
      csv(columns, regionalProviders.map(kitRow)),
    );
    assert.equal(scopedRun(["--write"]).status, 1, missing);
  }
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI rejects forged subset and full-catalog identity or geography columns", (t) => {
  const { root, run, rows, saveKit, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const field of kitColumns.filter((column) => column !== "provider_id")) {
    saveKit([
      { ...rows[0], [field]: field === "zip" ? "2459" : "FORGED_VALUE" },
      rows[1],
    ]);
    assert.equal(scopedRun(["--write"]).status, 1, field);
  }
  const fullRows = appCatalog.map(kitRow);
  writeFileSync(join(root, "all.csv"), csv(kitColumns, fullRows));
  const fullResult = run(["--catalog", "all.csv"]);
  assert.equal(fullResult.status, 0, fullResult.stderr);
  for (const field of ["lat", "lng"]) {
    writeFileSync(
      join(root, "all.csv"),
      csv(
        kitColumns,
        fullRows.map((row) =>
          row.provider_id === "privatus-boston"
            ? { ...row, [field]: "0" }
            : row,
        ),
      ),
    );
    assert.equal(run(["--catalog", "all.csv", "--write"]).status, 1, field);
  }
  for (const field of [
    "name",
    "state",
    "city",
    "zip",
    "address",
    "care_category",
  ]) {
    writeFileSync(
      join(root, "all.csv"),
      csv(
        kitColumns,
        fullRows.map((row, i) =>
          i === 0 ? { ...row, [field]: "FORGED_VALUE" } : row,
        ),
      ),
    );
    assert.equal(run(["--catalog", "all.csv", "--write"]).status, 1, field);
  }
  saveKit(
    rows.map((row) => ({
      ...row,
      provider_name: "FORGED_ALIAS",
      category: row.care_category,
    })),
    [...kitColumns, "provider_name", "category"],
  );
  assert.equal(scopedRun(["--write"]).status, 1);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI rejects unknown, blank and duplicate kit identities and malformed CSV", (t) => {
  const { root, rows, saveKit, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const id of ["", " ", "invented-nj-location", regionalIds[1]]) {
    saveKit([{ ...rows[0], provider_id: id }, rows[1]]);
    assert.equal(scopedRun(["--write"]).status, 1, JSON.stringify(id));
  }
  for (const text of [
    "provider_id,provider_id\nx,x\n",
    "provider_id\n",
    "provider_id,name\nx\n",
    'provider_id,name\n"unclosed',
  ]) {
    writeFileSync(join(root, "kit.csv"), text);
    assert.equal(scopedRun(["--write"]).status, 1);
  }
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI rejects malformed, unknown, missing, extra and wrong-geography assignments", (t) => {
  const { root, saveAssignment, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const assignment of [
    null,
    {},
    [],
    [""],
    ["unknown"],
    [regionalIds[0], regionalIds[0]],
    { ...regionalAssignment, providerIds: [] },
    { ...regionalAssignment, providerIds: [""] },
    { ...regionalAssignment, providerIds: ["unknown"] },
    { ...regionalAssignment, providerIds: [regionalIds[0], regionalIds[0]] },
    { ...regionalAssignment, providerIds: [regionalIds[0]] },
    {
      ...regionalAssignment,
      providerIds: [...regionalIds, "lifeplan-lasell-village"],
    },
    ...[
      { state: "NJ" },
      { state: "ma" },
      { state: "" },
      { state: "MA", cities: ["Wakefield"] },
      { state: "MA", cities: ["Newton"], zips: ["02466"] },
      { state: "MA", cities: [] },
      { state: "MA", cities: ["Newton", "Newton"] },
      { state: "MA", cities: [" Newton"] },
      { state: "MA", zips: [2459] },
      { state: "MA", zips: ["2459"] },
      { state: "MA", county: "Middlesex" },
    ].map((geography) => ({ ...regionalAssignment, geography })),
  ]) {
    saveAssignment(assignment);
    assert.equal(scopedRun(["--write"]).status, 1, JSON.stringify(assignment));
  }
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI requires exact assigned coverage and rejects out-of-assignment observations without filtering", (t) => {
  const { root, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const rows of [
    [coverage({ provider_id: regionalIds[0] })],
    [
      coverage({ provider_id: regionalIds[0] }),
      notSearched(regionalIds[1]),
      notSearched("lifeplan-lasell-village"),
    ],
    [
      coverage({ provider_id: regionalIds[0] }),
      notSearched(regionalIds[1]),
      notSearched(regionalIds[1]),
    ],
    [coverage({ provider_id: regionalIds[0] }), notSearched("unknown")],
    [coverage({ provider_id: regionalIds[0] }), notSearched("")],
  ]) {
    writeFileSync(join(root, "coverage.csv"), csv(COVERAGE_COLUMNS, rows));
    const result = scopedRun(["--write"]);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout).artifacts, []);
  }
  for (const id of ["lifeplan-lasell-village", "unknown", ""]) {
    writeFileSync(
      join(root, "coverage.csv"),
      csv(COVERAGE_COLUMNS, [
        notSearched(regionalIds[0]),
        notSearched(regionalIds[1]),
      ]),
    );
    writeFileSync(
      join(root, "observations.csv"),
      csv(OBSERVATION_COLUMNS, [observation({ provider_id: id })]),
    );
    const result = scopedRun(["--write"]);
    assert.equal(result.status, 1, JSON.stringify(id));
    assert.deepEqual(JSON.parse(result.stdout).artifacts, []);
  }
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI regional validation still rejects restricted research without content in diagnostics", (t) => {
  const { root, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [
      observation({
        provider_id: regionalIds[0],
        source_visibility: "private_authorized",
        summary: "SECRET_REGIONAL_CONTENT",
      }),
    ]),
  );
  const result = scopedRun(["--write"]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET_REGIONAL_CONTENT/);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI accepts the regional guide's exact manifest and CSV examples as an unsearched dry-run", (t) => {
  const { root, saveAssignment, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const guide = readFileSync(
    resolve("docs/regional-research-import.md"),
    "utf8",
  );
  const manifest = guide.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(manifest);
  saveAssignment(JSON.parse(manifest[1]));
  const examples = [...guide.matchAll(/```csv\n([\s\S]*?)\n```/g)];
  assert.equal(examples.length, 3);
  for (const [index, name] of [
    "kit.csv",
    "observations.csv",
    "coverage.csv",
  ].entries())
    writeFileSync(join(root, name), `${examples[index][1]}\n`);
  const result = scopedRun();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.counts, {
    inputObservations: 0,
    coverageRows: 2,
    restrictedRowsRejected: 0,
    catalogProviders: 521,
  });
  assert.equal(report.scope.kitProviders, 2);
  assert.equal(report.scope.assignedProviders, 2);
  assert.equal(existsSync(join(root, "artifacts")), false);
});

test("CLI keeps unresolved candidates unassigned for human review without pretending to verify geography", (t) => {
  const { root, scopedRun } = regionalFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "observations.csv"),
    csv(OBSERVATION_COLUMNS, [
      observation({
        provider_id: "",
        candidate_provider_name: "Synthetic unresolved candidate",
        match_status: "unresolved",
        supporting_public_excerpt: "",
      }),
    ]),
  );
  writeFileSync(
    join(root, "coverage.csv"),
    csv(COVERAGE_COLUMNS, [
      coverage({ provider_id: regionalIds[0], status: "ambiguous_only" }),
      notSearched(regionalIds[1]),
    ]),
  );
  const result = scopedRun(["--write"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const staging = JSON.parse(
    readFileSync(join(root, report.artifacts[0].path), "utf8"),
  );
  assert.equal(staging.observations.length, 1);
  assert.equal(staging.observations[0].providerId, null);
  assert.equal(staging.observations[0].needsHumanReview, true);
  assert.equal(staging.observations[0].publishable, false);
  assert.ok(
    report.warnings.some(
      (issue: { code: string }) => issue.code === "unresolved_count",
    ),
  );
});
