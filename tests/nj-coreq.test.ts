import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import snapshot from "../src/data/nj-coreq.json";
import { NjCoreqSurvey } from "../src/components/nj-coreq-survey";
import { getMarket } from "../src/lib/markets";
import type { Provider } from "../src/lib/providers";
import { getLocationResearch } from "../src/lib/location-research";

const root = new URL("../", import.meta.url);
const workbook =
  process.env.HARBOR_COREQ_WORKBOOK ?? "/tmp/harbor-nj-coreq.xlsx";
const costReport =
  process.env.HARBOR_NJ_COST_REPORT ?? "/tmp/harbor-nj-costreport.xlsx";
const script = new URL("scripts/regions/nj-coreq.py", root).pathname;
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const {
  ProviderDetail,
}: typeof import("../src/components/provider-detail") = require("../src/components/provider-detail");
const providers = getMarket("north-jersey")!.providers;
const provider = providers.find((row) => row.id === "cms-315083")!;
const render = (value: Provider) =>
  renderToStaticMarkup(createElement(NjCoreqSurvey, { provider: value }));

test("CoreQ import guards pass for zero, sentinel values and statewide identity conflicts", () => {
  const result = spawnSync(
    "python3",
    [new URL("scripts/regions/nj-coreq-test.py", root).pathname],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test(
  "the official workbook deterministically regenerates the exact separate projection",
  {
    skip:
      (!existsSync(workbook) || !existsSync(costReport)) &&
      "Supply the official FY2027 workbook separately",
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "harbor-coreq-"));
    try {
      const output = join(directory, "nj-coreq.json");
      const args = [
        script,
        "--workbook",
        workbook,
        "--cost-report",
        costReport,
      ];
      const run = (...extra: string[]) => {
        const result = spawnSync("python3", [...args, ...extra], {
          cwd: root,
          encoding: "utf8",
          timeout: 30_000,
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout);
      };
      const first = run("--output", output);
      assert.equal(first.emitted, Object.keys(snapshot.results).length);
      const expected = readFileSync(
        new URL("src/data/nj-coreq.json", root),
        "utf8",
      );
      assert.equal(readFileSync(output, "utf8"), expected);
      assert.deepEqual(run("--output", output), first);
      run("--output", output, "--check");
      run("--check");
      writeFileSync(output, "{}\n");
      const drift = spawnSync(
        "python3",
        [...args, "--output", output, "--check"],
        { cwd: root, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(drift.status, 0);
      assert.equal(readFileSync(output, "utf8"), "{}\n");
      assert.equal(
        first.emitted +
          Object.values(
            first.withheld as Record<string, { count: number }>,
          ).reduce((sum, category) => sum + category.count, 0),
        370,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("every result retains separate official identity evidence and source hashes", () => {
  for (const source of [snapshot.source.cms, snapshot.source.state]) {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(source.file, root)))
        .digest("hex"),
      source.sha256,
    );
  }
  assert.equal(snapshot.source.reportingYear, "FY2027");
  assert.equal(snapshot.source.unit, "percent");
  assert.equal(snapshot.source.workbook.headerCell, "AZ5");
  assert.equal(snapshot.source.workbook.numberFormat, "0%");
  assert.equal(snapshot.source.surveyPeriod, null);
  assert.equal(snapshot.source.sampleSize, null);
  assert.deepEqual(
    {
      value: snapshot.results["315083"].value,
      raw: snapshot.results["315083"].raw,
      cell: snapshot.results["315083"].cell,
      medicaidId: snapshot.results["315083"].identity.medicaidId,
      stateFacilityId: snapshot.results["315083"].identity.stateFacilityId,
    },
    {
      value: 96,
      raw: "0.96",
      cell: "AZ8",
      medicaidId: "917532",
      stateFacilityId: "60909",
    },
  );
  for (const [ccn, result] of Object.entries(snapshot.results)) {
    assert.match(ccn, /^315\d{3}$/);
    assert.ok(Number.isFinite(result.value));
    assert.ok(result.value >= 0 && result.value <= 100);
    assert.equal(result.identity.state, "NJ");
    assert.match(result.identity.medicaidId, /^\d+$/);
    if ("npi" in result.identity) {
      assert.match(result.identity.npi!, /^\d{10}$/);
      assert.equal(result.identity.method, "NJ-Medicaid-ID-to-NPI-to-CCN");
    } else {
      assert.ok(result.identity.stateFacilityId);
      assert.ok(result.identity.stateRow > 1);
      assert.equal(
        result.identity.method,
        "statewide-unique-exact-name-and-DOH-address",
      );
    }
    assert.equal(result.cell, result.identity.nameCell.replace(/^A/, "AZ"));
  }
});

test("the survey displays the published composite and units, with direct official links", () => {
  const html = render(provider);
  assert.match(html, /96%/);
  assert.match(html, /CoreQ satisfaction composite/);
  assert.match(html, /FY2027.*reporting\/payment year, not the survey year/);
  assert.match(html, /survey period and sample size are not published/);
  assert.match(html, /CMS CCN 315083/);
  assert.match(html, /Medicaid Gainwell ID 917532/);
  assert.match(html, /cell AZ8/);
  assert.ok(html.includes(snapshot.source.workbook.url));
  assert.ok(html.includes(snapshot.source.definitionUrl));
  const original = snapshot.results["315083"].value;
  try {
    snapshot.results["315083"].value = 0;
    assert.match(render(provider), />0%<\/strong>/);
  } finally {
    snapshot.results["315083"].value = original;
  }
});

test("unsupported profiles and wrong settings, states or CCNs do not inherit survey evidence", () => {
  for (const candidate of providers) {
    if (
      candidate.category !== "nursing-home" ||
      !candidate.cms ||
      !Object.hasOwn(snapshot.results, candidate.cms.ccn)
    ) {
      assert.equal(render(candidate), "", candidate.id);
    }
  }
  for (const changes of [
    { category: "assisted-living" },
    { category: "life-plan" },
    { category: "home-care" },
    { category: "home-health" },
    { state: "MA" },
    { officialRecord: false },
    { locationKind: "office" },
    { cms: undefined },
    { cms: { ...provider.cms!, ccn: "315029" } },
    { cms: { ...provider.cms!, ccn: "317001" } },
    { id: "campus-sister-facility" },
    { id: "cms-__proto__", cms: { ...provider.cms!, ccn: "__proto__" } },
  ] satisfies Partial<Provider>[]) {
    assert.equal(
      render({ ...provider, ...changes }),
      "",
      JSON.stringify(changes),
    );
  }
});

test("the survey belongs only to Reviews and never changes Harbor experience or aggregates", () => {
  const before = getLocationResearch(provider.id)!;
  assert.ok(before);
  for (const initialPane of [
    "overview",
    "costs",
    "reviews",
    "details",
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(ProviderDetail, {
        provider,
        initialPane,
        saved: false,
        note: "",
        onSave() {},
        onNote: () => true,
        onTask: () => true,
        close() {},
        saveStatus: "",
        saveError: "",
      }),
    );
    assert.equal(
      html.includes("NJ resident &amp; family survey"),
      initialPane === "reviews",
    );
    assert.equal(html.includes("96%"), initialPane === "reviews");
  }
  const original = snapshot.results["315083"].value;
  try {
    snapshot.results["315083"].value = 0;
    assert.deepEqual(getLocationResearch(provider.id), before);
  } finally {
    snapshot.results["315083"].value = original;
  }
  assert.equal(JSON.stringify(before).includes("CoreQ"), false);
  assert.equal(JSON.stringify(before).includes("917532"), false);
});
