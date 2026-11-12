import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import evidence from "../src/data/daily-life-evidence.json";
import { getDailyLifeResearch } from "../src/lib/daily-life";

const root = path.resolve(import.meta.dirname, "..");
const input = path.join(root, "research/daily-life");
const builder = path.join(root, "scripts/prepare-daily-life.py");

test("daily-life reader preserves exact-location evidence and source meaning", () => {
  const record = getDailyLifeResearch("north-jersey-doh-nj5a003");
  assert.ok(record);
  assert.equal(record.providerId, "north-jersey-doh-nj5a003");
  const staffing = record.facts.find((f) => f.kind === "staffing");
  assert.ok(staffing);
  assert.equal(staffing.numeric.value, 24);
  assert.equal(staffing.numeric.unit, "hours-per-day");
  assert.match(staffing.numeric.population, /Licensed nursing coverage/);
  assert.match(staffing.text, /not hours per resident/);
  assert.match(record.sources[0].locationEvidence, /567 Paramus Road/);
  for (const fact of record.facts) {
    const source = record.sources.find((s) => s.id === fact.sourceId);
    assert.ok(source);
    assert.ok(source.excerpt.includes(fact.quote));
    assert.equal(fact.evidence, "provider-reported");
  }
});

test("included care hours and on-call staff do not become numeric staffing", () => {
  const record = getDailyLifeResearch("north-jersey-doh-nj02a020a");
  assert.ok(record);
  const allowance = record.facts.find((f) =>
    f.text.includes("five personal-care"),
  );
  assert.ok(allowance);
  assert.equal(allowance.kind, "care-support");
  assert.equal(allowance.numeric, undefined);
  assert.equal(
    record.facts.some((f) => f.kind === "staffing"),
    false,
  );
  assert.equal(
    record.facts.some((f) => f.kind === "transport"),
    true,
  );
  assert.equal(
    record.facts.some((f) => f.kind === "trip"),
    false,
  );
});

test("medical shuttles and explicit recreational outings stay distinct", () => {
  const record = getDailyLifeResearch("cms-315005");
  assert.ok(record);
  const transport = record.facts.find((f) => f.kind === "transport");
  const trip = record.facts.find((f) => f.kind === "trip");
  assert.match(transport?.quote ?? "", /medical appointments/);
  assert.match(trip?.quote ?? "", /Outings to local attractions/);
  assert.notEqual(transport?.id, trip?.id);
});

test("Massachusetts communities keep their own published service allowances", () => {
  const arlington = getDailyLifeResearch("ma-alr-brightview-arlington");
  const northAndover = getDailyLifeResearch("ma-alr-brightview-north-andover");
  const canton = getDailyLifeResearch("ma-alr-brightview-canton");
  assert.ok(arlington && northAndover && canton);
  assert.equal(
    arlington.facts.some((f) => /five personal-care/.test(f.text)),
    false,
  );
  assert.equal(
    northAndover.facts.some((f) => /five personal-care/.test(f.text)),
    true,
  );
  assert.equal(
    canton.facts.some((f) => f.kind === "care-support"),
    false,
  );
  for (const record of [arlington, northAndover, canton])
    assert.ok(
      record.sources.every((s) => s.locationEvidence.includes(", MA ")),
    );
});

test("small-home meal counts are not staff counts and address conflicts stay withheld", () => {
  const chester = getDailyLifeResearch("north-jersey-doh-njd35011");
  assert.ok(chester);
  assert.match(
    chester.facts.find((f) => f.kind === "dining")?.text ?? "",
    /Three meals and three planned snacks/,
  );
  assert.equal(
    chester.facts.some((f) => f.kind === "staffing"),
    false,
  );
  assert.equal(getDailyLifeResearch("north-jersey-doh-njd35018"), null);
  assert.equal(getDailyLifeResearch("north-jersey-doh-njd35019"), null);
});

test("unknown and unresearched providers do not inherit evidence", () => {
  for (const id of [
    "",
    "toString",
    "__proto__",
    "not-a-provider",
    "north-jersey-doh-nj60a011",
  ])
    assert.equal(getDailyLifeResearch(id), null);
  const first = getDailyLifeResearch("north-jersey-doh-nj5a003");
  assert.ok(first);
  first.facts.length = 0;
  assert.ok(getDailyLifeResearch("north-jersey-doh-nj5a003")?.facts.length);
});

test("every published fact resolves to an attributed exact-location source", () => {
  for (const [pid, record] of Object.entries(evidence.locations)) {
    assert.equal(pid, record.providerId);
    assert.ok(record.facts.length > 0);
    const ids = new Set(record.sources.map((s) => s.id));
    assert.equal(ids.size, record.sources.length);
    for (const fact of record.facts) {
      assert.ok(ids.has(fact.sourceId));
      assert.equal(fact.evidence, "provider-reported");
      const source = record.sources.find((s) => s.id === fact.sourceId);
      assert.ok(source?.excerpt.includes(fact.quote));
      assert.match(source?.url ?? "", /^https:\/\//);
      assert.match(source?.locationEvidence ?? "", /\b(?:MA|NJ) \d{5}\b/);
      if (fact.kind === "trip")
        assert.match(fact.quote, /\b(outings?|trips?|excursions?)\b/i);
    }
  }
});

test("the standalone rebuild reproduces the shipped artifact and source receipts", () => {
  const result = execFileSync("python3", [builder, "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  const stats = JSON.parse(result);
  assert.equal(stats.providers, Object.keys(evidence.locations).length);
  assert.equal(
    stats.facts,
    Object.values(evidence.locations).reduce((n, r) => n + r.facts.length, 0),
  );
  assert.ok(stats.byState.NJ > stats.byState.MA);
});

test("reviewed NJ properties keep dining, activities and dated evidence limits distinct", () => {
  const orangePark = getDailyLifeResearch("cms-315178");
  const harborview = getDailyLifeResearch("cms-315310");
  const hamiltonPark = getDailyLifeResearch("cms-315300");
  assert.ok(orangePark && harborview && hamiltonPark);
  assert.match(
    orangePark.facts.find((f) => f.kind === "dining")?.quote ?? "",
    /dietician-approved meals/,
  );
  assert.ok(
    orangePark.sources.some((s) => s.locationEvidence.includes("140 Park Ave")),
  );
  assert.ok(harborview.facts.every((f) => f.kind === "activity"));
  const trip = hamiltonPark.facts.find((f) => f.kind === "trip");
  assert.match(trip?.quote ?? "", /outing to a local park/);
  assert.match(trip?.text ?? "", /date is not shown/);
  assert.match(trip?.text ?? "", /rather than a current excursion schedule/);
});

test("every retained excerpt has an independent live-source audit receipt", () => {
  const captures = JSON.parse(
    readFileSync(path.join(input, "source-captures.json"), "utf8"),
  );
  const audit = JSON.parse(
    readFileSync(path.join(input, "live-source-audit.json"), "utf8"),
  );
  const checks = new Map<
    string,
    { status: string; httpStatus: number; missing: string[] }
  >(audit.checks.map((check: { capture: string }) => [check.capture, check]));
  assert.equal(checks.size, Object.keys(captures).length);
  for (const slug of Object.keys(captures)) {
    const check = checks.get(slug);
    assert.ok(check, slug);
    assert.equal(check.status, "confirmed", slug);
    assert.equal(check.httpStatus, 200, slug);
    assert.deepEqual(check.missing, [], slug);
  }
});

test("the acquisition boundary rejects semantic, identity and retrieval mismatches", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harbor-daily-life-test-"));
  const run = () =>
    execFileSync(
      "python3",
      [
        "-c",
        "import runpy,sys; from pathlib import Path; runpy.run_path(sys.argv[1])['build'](Path(sys.argv[2]))",
        builder,
        directory,
      ],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    );
  try {
    for (const name of [
      "reviewed-pages.json",
      "source-captures.json",
      "excluded-pages.json",
    ])
      writeFileSync(
        path.join(directory, name),
        readFileSync(path.join(input, name)),
      );
    const pages = JSON.parse(
      readFileSync(path.join(directory, "reviewed-pages.json"), "utf8"),
    );
    const spring = pages.find(
      (p: { capture: string }) => p.capture === "spring-grove",
    );
    assert.ok(spring);
    spring.facts.find((f: { kind: string }) => f.kind === "transport").kind =
      "trip";
    writeFileSync(
      path.join(directory, "reviewed-pages.json"),
      JSON.stringify(pages),
    );
    assert.throws(run, /Transport is not an excursion/);
    spring.facts.find((f: { quote: string }) =>
      f.quote.includes("Shuttle"),
    ).kind = "transport";
    const support = pages.find(
      (p: { capture: string }) => p.capture === "brightview-paramus-pricing",
    );
    const claim = support.facts.find(
      (f: { quote: string }) => f.quote === "Dedicated staff on call 24-7",
    );
    claim.kind = "staffing";
    claim.numeric = {
      value: 24,
      unit: "hours-per-day",
      population: "All residents",
      period: null,
    };
    writeFileSync(
      path.join(directory, "reviewed-pages.json"),
      JSON.stringify(pages),
    );
    assert.throws(run, /Unreviewed staffing metric/);
    claim.kind = "care-support";
    delete claim.numeric;
    support.capture = "brightview-tenafly-pricing";
    writeFileSync(
      path.join(directory, "reviewed-pages.json"),
      JSON.stringify(pages),
    );
    assert.throws(run, /Identity is not the same location path/);
    support.capture = "brightview-paramus-pricing";
    support.zip = "07000";
    writeFileSync(
      path.join(directory, "reviewed-pages.json"),
      JSON.stringify(pages),
    );
    assert.throws(run, /State or ZIP disagrees/);
    support.zip = "07652";
    claim.quote =
      "A staffing statement that is not on the retained provider page.";
    writeFileSync(
      path.join(directory, "reviewed-pages.json"),
      JSON.stringify(pages),
    );
    assert.throws(run, /Unsupported claim/);
    claim.quote = "Dedicated staff on call 24-7";
    writeFileSync(
      path.join(directory, "reviewed-pages.json"),
      JSON.stringify(pages),
    );
    const captures = JSON.parse(
      readFileSync(path.join(directory, "source-captures.json"), "utf8"),
    );
    assert.doesNotThrow(run);
    captures["brightview-paramus-pricing"].checkedAt = "2026-02-31";
    writeFileSync(
      path.join(directory, "source-captures.json"),
      JSON.stringify(captures),
    );
    assert.throws(run, /ValueError:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
