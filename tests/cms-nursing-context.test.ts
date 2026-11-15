import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GET } from "../src/app/api/research/route";
import { getLocationResearch } from "../src/lib/location-research";
import { getMarket, markets } from "../src/lib/markets";
import { computeExperienceScore } from "../src/lib/experience-score";
import type { LocationResearchResponse } from "../src/lib/location-research-types";

const rows: {
  cms_certification_number_ccn: string;
  countyparish: string;
  provider_type: string;
  with_a_resident_and_family_council: string;
  processing_date: string;
}[] = JSON.parse(
  readFileSync(
    new URL(
      "../research/north-jersey/cms/datasets/4pq5-n9py.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const counties = new Set([
  "Union",
  "Morris",
  "Essex",
  "Bergen",
  "Hudson",
  "Passaic",
]);
const targets = rows.filter((row) => counties.has(row.countyparish));
const contextFact = (id: string) =>
  /-cms-(program-participation|councils)$/.test(id);

test("the research API projects participation and council facts for all 139 exact NJ CCNs", async () => {
  assert.equal(targets.length, 139);
  const councilText: Record<string, string> = {
    Resident: "CMS lists a resident council only.",
    Family: "CMS lists a family council only.",
    Both: "CMS lists both a resident council and a family council.",
    None: "CMS lists neither a resident nor a family council.",
  };
  let medicareOnly = 0;
  for (const row of targets) {
    const id = `cms-${row.cms_certification_number_ccn}`;
    const response = GET(new Request(`http://localhost/api/research?id=${id}`));
    assert.equal(response.status, 200, id);
    const detail: LocationResearchResponse = await response.json();
    const facts = detail.facts.filter((fact) => contextFact(fact.id));
    assert.equal(facts.length, 2, id);
    const [participation, council] = facts;
    assert.equal(
      council.text,
      councilText[row.with_a_resident_and_family_council],
      id,
    );
    if (row.provider_type === "Medicare") {
      medicareOnly++;
      assert.match(participation.text, /Medicare participation only/);
      assert.match(
        participation.text,
        /Medicaid participation is not reported/,
      );
    } else {
      assert.equal(row.provider_type, "Medicare and Medicaid");
      assert.match(participation.text, /Medicare and Medicaid participation/);
    }
    assert.match(
      participation.text,
      /does not establish individual coverage, eligibility or bed availability/,
    );
    for (const fact of facts) {
      assert.equal(fact.kind, "care");
      assert.equal(fact.asOf, row.processing_date);
      assert.equal(fact.asOf, "2026-10-01");
      assert.equal(fact.amount, undefined);
      const source = detail.sources.find(
        (source) => source.id === fact.sourceId,
      )!;
      assert.equal(source.kind, "regulator");
      assert.equal(
        source.url,
        "https://data.cms.gov/provider-data/dataset/4pq5-n9py",
      );
      assert.match(source.title, new RegExp(row.cms_certification_number_ccn));
      assert.match(source.title, /processing date 2026-10-01/);
      assert.equal(source.checkedAt, "2026-11-12");
      assert.equal(source.publishedAt, "2026-10-28");
    }
    const internal = getLocationResearch(id, "2026-11-15");
    assert.deepEqual(
      internal.experience,
      computeExperienceScore({
        ...internal,
        sources: internal.sources.filter(
          (source) => source.id !== facts[0].sourceId,
        ),
        asOfDate: "2026-11-15",
      }),
      id,
    );
  }
  assert.equal(medicareOnly, 8);
});

test("state-only co-located units and Massachusetts never inherit NJ CMS context", async () => {
  const eligible = new Set(
    targets.map((row) => `cms-${row.cms_certification_number_ccn}`),
  );
  for (const market of markets) {
    for (const provider of market.providers) {
      if (eligible.has(provider.id)) continue;
      assert.equal(
        getLocationResearch(provider.id).facts.some((fact) =>
          contextFact(fact.id),
        ),
        false,
        provider.id,
      );
    }
  }
  const market = getMarket("north-jersey")!;
  const nursing = market.providers.find(
    (provider) => provider.id === "cms-315369",
  )!;
  const sibling = market.providers.find(
    (provider) => provider.id === "north-jersey-doh-njal0209",
  )!;
  assert.equal(sibling.address, nursing.address);
  assert.equal(sibling.zip, nursing.zip);
  const response = GET(
    new Request(`http://localhost/api/research?id=${sibling.id}`),
  );
  const detail: LocationResearchResponse = await response.json();
  assert.equal(detail.facts.filter((fact) => contextFact(fact.id)).length, 0);
});

test("validated registry-only offices expose their service evidence without replacing registry phones", async () => {
  const services: {
    providerId: string;
    phone: string;
    sourceUrl: string;
    text: string;
    workforceTraining?: boolean;
  }[] = JSON.parse(
    readFileSync(
      new URL(
        "../research/north-jersey/home-care-pay-services/verified-office-services.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ids = ["hp0366200", "hp0229600", "hp0368100", "hp0413700", "hp0421200"];
  const market = getMarket("north-jersey")!;
  for (const suffix of ids) {
    const id = `north-jersey-hp-${suffix}`;
    const retained = services.find((row) => row.providerId === id)!;
    const provider = market.providers.find((row) => row.id === id)!;
    assert.equal(provider.phone, retained.phone);
    const response = GET(new Request(`http://localhost/api/research?id=${id}`));
    assert.equal(response.status, 200);
    const detail: LocationResearchResponse = await response.json();
    const key = retained.workforceTraining
      ? "office-training"
      : "office-services";
    const fact = detail.facts.find((fact) => fact.id === `${id}-${key}`)!;
    assert.equal(fact.text, retained.text);
    assert.equal(
      detail.sources.find((source) => source.id === fact.sourceId)?.url,
      retained.sourceUrl,
    );
    assert.equal(detail.experience.value, null);
    assert.equal(detail.availability.status, "not-published");
  }
  const training = getLocationResearch("north-jersey-hp-hp0229600");
  assert.match(
    training.facts.find((fact) => fact.id.endsWith("-office-training"))!.text,
    /workforce training, not home visits/,
  );
  assert.equal(
    training.facts.some((fact) => fact.id.endsWith("-office-services")),
    false,
  );
  for (const suffix of ["hp0127200", "hp0282000"]) {
    assert.equal(
      getLocationResearch(`north-jersey-hp-${suffix}`).facts.some(
        (fact) => fact.id === `north-jersey-hp-${suffix}-office-services`,
      ),
      false,
    );
  }
});
