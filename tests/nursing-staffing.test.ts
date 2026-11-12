import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getNursingStaffingResearch } from "../src/lib/nursing-staffing";
import { markets } from "../src/lib/markets";
import { GET } from "../src/app/api/research/route";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const {
  Staffing,
}: typeof import("../src/components/staffing") = require("../src/components/staffing");
const root = new URL("../", import.meta.url);
const snapshot = JSON.parse(
  readFileSync(new URL("src/data/nursing-staffing.json", root), "utf8"),
);

test("staffing rebuild and source-boundary checks pass offline", () => {
  for (const args of [
    ["scripts/prepare-nursing-staffing.py", "--check"],
    ["tests/nursing-staffing.test.py"],
  ]) {
    const result = spawnSync("python3", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test("the existing research route delivers one exact provider's staffing, not statewide data", async () => {
  for (const id of ["cms-225506", "cms-315146"]) {
    const response = GET(new Request(`http://localhost/api/research?id=${id}`));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.nursingStaffing, getNursingStaffingResearch(id));
    assert.equal(data.nursingStaffing.providerId, id);
    assert.equal(Object.keys(data.nursingStaffing.metrics).length, 9);
    assert.equal(data.nursingStaffing.providers, undefined);
    assert.equal(data.nursingStaffing.inputs, undefined);
  }
  const response = GET(
    new Request("http://localhost/api/research?id=north-jersey-doh-nj60709"),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).nursingStaffing, undefined);
});

test("every published exact-CCN nursing home in both markets has staffing evidence", () => {
  const expected = markets
    .flatMap((market) => market.providers)
    .filter((provider) => provider.category === "nursing-home" && provider.cms);
  assert.deepEqual(
    Object.keys(snapshot.providers).sort(),
    expected.map((provider) => provider.id).sort(),
  );
  const states = new Set<string>();
  for (const provider of expected) {
    const evidence = getNursingStaffingResearch(provider.id);
    assert.ok(evidence, provider.id);
    assert.equal(evidence.ccn, provider.cms!.ccn);
    assert.equal(evidence.state, provider.state);
    assert.equal(evidence.providerId, provider.id);
    assert.deepEqual(
      [evidence.staffingPeriod.startDate, evidence.staffingPeriod.endDate],
      ["2026-04-01", "2026-06-30"],
    );
    assert.deepEqual(
      [evidence.turnoverPeriod.startDate, evidence.turnoverPeriod.endDate],
      ["2025-04-01", "2026-03-31"],
    );
    assert.equal(evidence.processingDate, "2026-10-01");
    assert.match(evidence.careCompareUrl, new RegExp(`/${provider.cms!.ccn}$`));
    states.add(provider.state);
  }
  assert.deepEqual([...states].sort(), ["MA", "NJ"]);
});

test("every reported metric agrees with its retained exact-CCN source row", () => {
  const files = new Map<string, unknown>();
  for (const market of markets) {
    for (const provider of market.providers) {
      const evidence = getNursingStaffingResearch(provider.id);
      if (!evidence) continue;
      const receipt = evidence.sourceReceipt;
      const path = new URL(receipt.file, root);
      const body = readFileSync(path);
      assert.equal(
        createHash("sha256").update(body).digest("hex"),
        receipt.sha256,
      );
      if (!files.has(receipt.file))
        files.set(receipt.file, JSON.parse(body.toString()));
      const payload = files.get(receipt.file) as
        { results?: Record<string, unknown>[] } | Record<string, unknown>[];
      const source = (Array.isArray(payload) ? payload : payload.results!)[
        receipt.rowIndex
      ];
      assert.equal(
        source.cmsCertificationNumber ?? source.cms_certification_number_ccn,
        evidence.ccn,
      );
      const values = source.staffing as Record<string, unknown> | undefined;
      for (const [key, metric] of Object.entries(evidence.metrics)) {
        const raw =
          key === "census" && values
            ? source.averageResidentsPerDay
            : (values ?? source)[metric.sourceField];
        if (metric.status === "reported") {
          assert.notEqual(raw, "");
          assert.notEqual(raw, null);
          assert.notEqual(raw, undefined);
          assert.equal(metric.value, Number(raw), `${provider.id}/${key}`);
          assert.equal(
            metric.unit,
            key.endsWith("Turnover")
              ? "percent"
              : key === "census"
                ? "residents per day"
                : "hours per resident-day",
          );
        } else {
          assert.equal(metric.value, null);
          if (metric.status === "suppressed") assert.ok(metric.footnote);
        }
      }
    }
  }
});

test("non-nursing settings, state-only listings and unknown IDs never inherit CMS staffing", () => {
  for (const provider of markets.flatMap((market) => market.providers)) {
    if (provider.category !== "nursing-home" || !provider.cms) {
      assert.equal(getNursingStaffingResearch(provider.id), null, provider.id);
    }
  }
  for (const id of ["cms-015009", "225506", "__proto__", "cms-999999"]) {
    assert.equal(getNursingStaffingResearch(id), null);
  }
  assert.ok(Object.keys(snapshot.excluded).length > 0);
  for (const id of Object.keys(snapshot.excluded)) {
    assert.equal(getNursingStaffingResearch(id), null);
  }
});

test("MA and NJ suppression and rating notes remain distinct from staffing hours", () => {
  for (const id of ["cms-225281", "cms-315146"]) {
    const evidence = getNursingStaffingResearch(id)!;
    for (const key of [
      "total",
      "rn",
      "lpn",
      "aide",
      "weekendTotal",
      "weekendRn",
    ] as const) {
      assert.equal(evidence.metrics[key].status, "suppressed");
      assert.equal(evidence.metrics[key].value, null);
      assert.match(evidence.metrics[key].footnote!, /could not be validated/);
    }
  }
  const warning = getNursingStaffingResearch("cms-225067")!;
  assert.match(
    warning.staffingRatingNote!,
    /without a registered nurse onsite/,
  );
  assert.equal(warning.metrics.rn.status, "reported");
});

test("staffing reader responses do not share mutable metrics with the snapshot", () => {
  const first = getNursingStaffingResearch("cms-225506")!;
  first.staffingPeriod.startDate = "2099-01-01";
  first.metrics.total.footnote = "Changed by caller";
  const next = getNursingStaffingResearch("cms-225506")!;
  assert.equal(next.staffingPeriod.startDate, "2026-04-01");
  assert.equal(next.metrics.total.footnote, null);
});

test("staffing component renders concise roles, units, separate periods and truthful gaps", () => {
  const evidence = getNursingStaffingResearch("cms-225506")!;
  const html = renderToStaticMarkup(
    createElement(Staffing, { staffing: evidence }),
  );
  for (const label of [
    "Registered nurses (RNs)",
    "Licensed practical nurses (LPNs)",
    "Nurse aides",
    "Weekend total",
    "Hours per resident-day",
    "Apr 1, 2026",
    "Jun 30, 2026",
    "Apr 1, 2025",
    "Mar 31, 2026",
    "not a simultaneous staff-to-resident ratio",
    "not a staff headcount",
  ]) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes("4.6"));
  assert.ok(html.includes("1.54"));
  assert.ok(html.includes("CCN 225506"));
  assert.ok(
    html.includes("https://data.cms.gov/provider-data/dataset/qmdc-9999"),
  );
  assert.equal(renderToStaticMarkup(createElement(Staffing, {})), "");
  const suppressed = renderToStaticMarkup(
    createElement(Staffing, {
      staffing: getNursingStaffingResearch("cms-315146"),
    }),
  );
  assert.ok(suppressed.includes("Suppressed by CMS"));
  assert.ok(suppressed.includes("could not be validated"));
  assert.ok(!suppressed.includes("NaN"));
  assert.ok(!suppressed.includes("null"));
});
