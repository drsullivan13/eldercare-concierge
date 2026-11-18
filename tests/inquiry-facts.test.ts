import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInquiryFact,
  summarizeInquiryFacts,
  type InquiryFact,
} from "../src/lib/inquiry-facts";
export const fact: InquiryFact = {
  id: "33333333-3333-4333-8333-333333333333",
  requestId: "44444444-4444-4444-8444-444444444444",
  providerId: "north-jersey-hp-hp1234567",
  careZip: "07601",
  kind: "hourly_rate",
  value: "35.00",
  checkedOn: "2026-11-01",
  validUntil: "2026-11-30",
  source: "family_reported_office_response",
};
test("private facts reject inferred confirmation, malformed dates, rates and unbounded fields", () => {
  assert.deepEqual(parseInquiryFact(fact, "2026-11-18"), fact);
  for (const patch of [
    { source: "verified" },
    { confirmed: true },
    { value: "10001" },
    { value: "NaN" },
    { kind: "minimum_hours", value: "169" },
    { checkedOn: "2026-02-30" },
    { checkedOn: "2026-12-01" },
    { validUntil: "2026-10-01" },
    { providerId: "x".repeat(101) },
    { kind: "coverage_zip", value: "yes" },
    { kind: "earliest_start", value: "soon" },
  ])
    assert.equal(parseInquiryFact({ ...fact, ...patch }, "2026-11-18"), null);
  assert.ok(
    parseInquiryFact({ ...fact, value: null, validUntil: null }, "2026-11-18"),
  );
});
test("history distinguishes conflicts, stale, unknown and family reports without confirmation", () => {
  const status = (facts: InquiryFact[]) =>
    summarizeInquiryFacts(facts, "2026-11-18").find(
      (s) => s.kind === "hourly_rate",
    )!;
  assert.equal(status([]).status, "unknown");
  assert.equal(status([fact]).status, "reported");
  assert.equal(status([fact, { ...fact, value: "35" }]).status, "reported");
  assert.equal(status([fact, { ...fact, value: "40" }]).status, "conflicting");
  assert.equal(status([{ ...fact, validUntil: "2026-11-10" }]).status, "stale");
  assert.equal(status([{ ...fact, validUntil: null }]).status, "unknown");
  assert.equal(
    status([fact, { ...fact, value: null, checkedOn: "2026-11-18" }]).status,
    "unknown",
  );
  assert.equal(status([fact]).facts.length, 1);
});
