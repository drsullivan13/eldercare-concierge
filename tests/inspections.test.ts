import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EvidenceInputError,
  getInspectionEvidence,
  MAX_EVIDENCE_RECORDS,
  scopeSeverityLabel,
  SCOPE_SEVERITY_GUIDE_URL,
  type HealthCitation,
  type PenaltyEvent,
} from "../src/lib/inspections";
import { GET } from "../src/app/api/evidence/route";

type SourceFacility = {
  healthCitations: { total: number; records: HealthCitation[] };
  penalties: { total: number; records: PenaltyEvent[] };
};
const raw = JSON.parse(
  readFileSync(
    new URL("../src/data/inspection-history.json", import.meta.url),
    "utf8",
  ),
) as { facilities: Record<string, SourceFacility> };
const knownCCNs = Object.keys(raw.facilities);

test("real nursing-home findings and penalties match downloaded CMS records exactly", () => {
  const evidence = getInspectionEvidence("225268", 25); // Care One at Newton, an actual source record.
  const source = raw.facilities["225268"];
  assert.equal(evidence.providerName, "CARE ONE AT NEWTON");
  assert.equal(evidence.healthCitations.total, source.healthCitations.total);
  assert.equal(evidence.penalties.total, source.penalties.total);
  assert.equal(
    evidence.penalties.records.find((row) => row.fineId === "136145")
      ?.fineAmount,
    10868,
  );
  const latest = evidence.healthCitations.records[0];
  assert.equal(latest.surveyDate, "2026-04-06");
  assert.equal(latest.tag, "F0628");
  assert.equal(latest.scopeSeverityCode, "D");
  assert.equal(
    latest.scopeSeverityLabel,
    "Isolated · No actual harm; potential for more than minimal harm, not immediate jeopardy",
  );
  assert.equal(latest.standard, false);
  assert.equal(latest.complaint, true);
  assert.equal(
    latest.description,
    "Provide the required documentation or notification related to the resident's needs, appeal rights, or bed-hold policies.",
  );
  for (const row of evidence.healthCitations.records)
    assert.ok(
      source.healthCitations.records.some(
        (original) =>
          original.id === row.id &&
          original.description === row.description &&
          original.scopeSeverityCode === row.scopeSeverityCode &&
          original.complaint === row.complaint &&
          original.standard === row.standard,
      ),
    );
  assert.equal(evidence.retrieved, "2026-11-11");
  assert.ok(
    evidence.sources.every(
      (source) =>
        source.modified === "2026-10-01" &&
        source.released === "2026-10-28" &&
        source.url.startsWith("https://data.cms.gov/provider-data/dataset/"),
    ),
  );
  assert.equal(
    evidence.careCompareUrl,
    "https://www.medicare.gov/care-compare/details/nursing-home/225268",
  );
  assert.equal(evidence.scopeSeverityGuideUrl, SCOPE_SEVERITY_GUIDE_URL);
});

test("CMS A–L grid explains scope and all four harm levels without treating missing/invalid codes as clearance", () => {
  const expected: Record<string, string> = {
    A: "Isolated · No actual harm; potential for minimal harm",
    B: "Pattern · No actual harm; potential for minimal harm",
    C: "Widespread · No actual harm; potential for minimal harm",
    D: "Isolated · No actual harm; potential for more than minimal harm, not immediate jeopardy",
    E: "Pattern · No actual harm; potential for more than minimal harm, not immediate jeopardy",
    F: "Widespread · No actual harm; potential for more than minimal harm, not immediate jeopardy",
    G: "Isolated · Actual harm, not immediate jeopardy",
    H: "Pattern · Actual harm, not immediate jeopardy",
    I: "Widespread · Actual harm, not immediate jeopardy",
    J: "Isolated · Immediate jeopardy to resident health or safety",
    K: "Pattern · Immediate jeopardy to resident health or safety",
    L: "Widespread · Immediate jeopardy to resident health or safety",
  };
  for (const [code, meaning] of Object.entries(expected))
    assert.equal(scopeSeverityLabel(code), meaning);
  for (const code of [null, undefined, "", "M", "Z", "d", " D", "AB", "0"])
    assert.equal(scopeSeverityLabel(code), null);
});

test("all real catalog findings are newest-first, bounded, deterministic, with totals before truncation", () => {
  for (const ccn of knownCCNs) {
    const evidence = getInspectionEvidence(ccn, MAX_EVIDENCE_RECORDS);
    assert.equal(
      evidence.healthCitations.total,
      raw.facilities[ccn].healthCitations.total,
    );
    assert.ok(evidence.healthCitations.records.length <= 25);
    assert.ok(evidence.penalties.records.length <= 25);
    const expectedDates = raw.facilities[ccn].healthCitations.records
      .map((row) => row.surveyDate ?? "")
      .sort()
      .reverse()
      .slice(0, 25);
    assert.deepEqual(
      evidence.healthCitations.records.map((row) => row.surveyDate),
      expectedDates,
    );
    const penaltyDates = evidence.penalties.records.map(
      (row) => row.date ?? "",
    );
    assert.deepEqual(penaltyDates, [...penaltyDates].sort().reverse());
    assert.equal(
      evidence.healthCitations.hasMore,
      evidence.healthCitations.total! > evidence.healthCitations.returned,
    );
  }
  assert.deepEqual(
    getInspectionEvidence("225268"),
    getInspectionEvidence("225268"),
  );
  const withMany = knownCCNs.find(
    (ccn) => raw.facilities[ccn].healthCitations.total > 25,
  )!;
  const first = getInspectionEvidence(withMany);
  const more = getInspectionEvidence(withMany, 10);
  assert.equal(first.healthCitations.records.length, 5);
  assert.deepEqual(
    first.healthCitations.records,
    more.healthCitations.records.slice(0, 5),
  );
  assert.equal(
    getInspectionEvidence(withMany, 25).healthCitations.hasMore,
    true,
  );
});

test("zero source rows remains zero, unknown fine amount remains null, payment denial is not a zero-dollar fine", () => {
  const noFindings = knownCCNs.find(
    (ccn) => raw.facilities[ccn].healthCitations.total === 0,
  )!;
  const evidence = getInspectionEvidence(noFindings);
  assert.equal(evidence.healthCitations.available, true);
  assert.equal(evidence.healthCitations.total, 0);
  assert.deepEqual(evidence.healthCitations.records, []);
  const noPenalties = knownCCNs.find(
    (ccn) => raw.facilities[ccn].penalties.total === 0,
  )!;
  assert.equal(getInspectionEvidence(noPenalties).penalties.fineCount, 0);
  const withDenial = knownCCNs.find((ccn) =>
    raw.facilities[ccn].penalties.records.some(
      (row) => row.type === "Payment Denial",
    ),
  )!;
  const denial = getInspectionEvidence(withDenial, 25).penalties.records.find(
    (row) => row.type === "Payment Denial",
  )!;
  assert.equal(denial.fineAmount, null);
  assert.notEqual(denial.paymentDenialLengthDays, null);
  assert.ok(denial.paymentDenialLengthDays! >= 0);
});

test("malformed, foreign and unrecognized CCNs never create findings", () => {
  for (const ccn of [
    "",
    "22526",
    "2252680",
    "cms-225268",
    "225268 ",
    "225268,225506",
    "__proto__",
  ]) {
    assert.throws(
      () => getInspectionEvidence(ccn),
      (error: unknown) =>
        error instanceof EvidenceInputError && error.status === 400,
    );
  }
  for (const ccn of ["015009", "999999"])
    assert.throws(
      () => getInspectionEvidence(ccn),
      (error: unknown) =>
        error instanceof EvidenceInputError && error.status === 404,
    );
  for (const limit of [
    "0",
    "-1",
    "26",
    "5000",
    "NaN",
    "Infinity",
    "1.5",
    "",
    " 5",
  ])
    assert.throws(
      () => getInspectionEvidence("225268", limit),
      EvidenceInputError,
    );
});

test("evidence API bounds output and rejects ambiguous or missing input", async () => {
  for (const query of [
    "",
    "?ccn=225268&ccn=225506",
    "?ccn=225268&limit=5&limit=25",
    "?ccn=225268&limit=26",
    "?ccn=ma-alr-adelaide-of-newton-centre",
  ]) {
    assert.equal(
      GET(new Request(`http://localhost/api/evidence${query}`)).status,
      400,
    );
  }
  assert.equal(
    GET(new Request("http://localhost/api/evidence?ccn=015009")).status,
    404,
  );
  const response = GET(
    new Request("http://localhost/api/evidence?ccn=225268&limit=10"),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ccn, "225268");
  assert.equal(result.limit, 10);
  assert.ok(result.healthCitations.records.length <= 10);
  assert.ok(result.penalties.records.length <= 10);
  assert.equal(result.sources.length, 2);
});
