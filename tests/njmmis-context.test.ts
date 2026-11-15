import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "../src/app/api/research/route";
import { getMarket } from "../src/lib/markets";

type OfficeEvidence = {
  providerId: string;
  evidenceId: string;
  sourceUrl: string;
  checkedAt: string;
  careServices: string[];
  sourceOffice: {
    name: string;
    address: string;
    city: string;
    zip: string;
    phone: string;
  };
};

const retained: OfficeEvidence[] = JSON.parse(
  readFileSync(
    new URL(
      "../research/north-jersey/home-care-network/njmmis-exports/verified.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("NJMMIS services reach the public detail API without changing experience or availability", async () => {
  const market = getMarket("north-jersey");
  assert.ok(market?.locationResearch);
  assert.ok(retained.length > 0);
  const published = market.locationResearch;
  try {
    for (const id of new Set(retained.map((row) => row.providerId))) {
      const record = published[id];
      assert.ok(record, id);
      const baseline = {
        ...record,
        facts: record.facts.filter((fact) => !fact.id.includes("-njmmis-")),
        sources: record.sources.filter(
          (source) => !source.id.includes("-njmmis-"),
        ),
      };
      market.locationResearch = { ...published, [id]: baseline };
      const before = await GET(
        new Request(`http://localhost/api/research?id=${id}`),
      ).json();
      market.locationResearch = published;
      const response = GET(
        new Request(`http://localhost/api/research?id=${id}`),
      );
      assert.equal(response.status, 200);
      const after = await response.json();
      assert.deepEqual(after.experience, before.experience, id);
      assert.deepEqual(after.availability, before.availability, id);
      assert.deepEqual(after.reviewAggregates, before.reviewAggregates, id);
      assert.deepEqual(after.reviews, before.reviews, id);
      for (const row of retained.filter((row) => row.providerId === id)) {
        const factId = `${id}-njmmis-${row.evidenceId}-services`;
        const fact = after.facts.find(
          (value: { id: string }) => value.id === factId,
        );
        assert.ok(fact, factId);
        assert.equal(fact.kind, "care");
        assert.match(fact.id, /-services(?:-\d+)?$/);
        assert.match(fact.text, /Confirm coverage.*with your health plan/);
        for (const service of row.careServices) {
          assert.ok(fact.text.includes(service));
        }
        assert.equal(fact.amount, undefined);
        assert.equal(fact.numericValue, undefined);
        const source = after.sources.find(
          (value: { id: string }) => value.id === fact.sourceId,
        );
        assert.ok(source);
        assert.equal(source.kind, "public-directory");
        assert.equal(source.url, row.sourceUrl);
        assert.equal(source.checkedAt, row.checkedAt);
        for (const value of Object.values(row.sourceOffice)) {
          assert.ok(source.excerpt.includes(value), value);
        }
        assert.doesNotMatch(
          JSON.stringify({ fact, source }),
          /billing phone|open to new patients|accepts insurance|Internal Medicine|TBI Respite Inpatient/i,
        );
      }
    }
  } finally {
    market.locationResearch = published;
  }
});
