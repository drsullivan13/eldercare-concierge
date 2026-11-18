import test from "node:test";
import inquiryRoutes from "../src/data/inputs/nj-home-care-inquiry-routes.json";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { markets } from "../src/lib/markets";
import {
  publicOfficeEvidence,
  officeEvidenceReview,
} from "../src/lib/public-office-evidence";
import {
  emptyLocationResearch,
  type OfferingFact,
} from "../src/lib/location-research-types";

const providers = markets.flatMap((market) => market.providers);
const office = providers.find(
  (provider) => provider.id === "north-jersey-hp-hp0015347",
)!;
function fixture(texts = ["Minimum shift is four hours."]) {
  const research = emptyLocationResearch(office.id);
  research.sources = texts.map((text, index) => ({
    id: `source-${index}`,
    url: `https://www.bayada.com/office/nj/morristown/policy-${index}`,
    title: "Office policy",
    publisher: "Office",
    kind: "provider",
    checkedAt: "2026-11-18",
    publishedAt: null,
    access: "full-page",
    excerpt: text,
  }));
  research.facts = texts.map((text, index): OfferingFact => ({
    id: `fact-${index}`,
    kind: "availability",
    text,
    sourceId: `source-${index}`,
    publicOfficeFact: {
      field: "minimum-hours",
      officeAddress: office.address,
      officeZip: office.zip,
    },
  }));
  return research;
}

test("released office routes and conservative ZIP facts retain actual dates, not the evaluation clock", () => {
  const report = officeEvidenceReview(providers, {}, "2026-11-18", 0);
  assert.equal(report.eligibleOffices, 824);
  assert.equal(report.counts.intake.known, 9);
  assert.equal(report.counts["service-zips"].known, 9);
  assert.equal(report.counts["minimum-hours"].unknown, 824);
  assert.equal(report.counts["earliest-start"].unknown, 824);
  const intake = publicOfficeEvidence(office, undefined, "2026-11-18")![0];
  assert.equal(intake.state, "known");
  assert.equal(intake.sources[0].checkedAt, "2026-11-13");
  assert.equal(intake.sources[0].expiresAt, "2026-12-13");
  assert.equal(
    publicOfficeEvidence(office, undefined, "2026-12-12")![0].state,
    "known",
  );
  const expired = publicOfficeEvidence(office, undefined, "2026-12-13")![0];
  assert.equal(expired.state, "stale");
  assert.equal(expired.value, undefined);
  assert.equal(expired.sources[0].checkedAt, "2026-11-13");
});

test("contradictory exact-office public sources are held, including stale conflicts", () => {
  const research = fixture([
    "Minimum shift is four hours.",
    "Minimum shift is eight hours.",
  ]);
  for (const at of ["2026-11-18", "2027-01-01"]) {
    const fact = publicOfficeEvidence(office, research, at)!.find(
      (fact) => fact.field === "minimum-hours",
    )!;
    assert.equal(fact.state, "conflicting");
    assert.equal(fact.value, undefined);
    assert.equal(fact.sources.length, 2);
  }
  const report = officeEvidenceReview(
    [office],
    { [office.id]: research },
    "2026-11-18",
    1,
  );
  assert.equal(report.review.length, 1);
  assert.equal(report.review[0].reason, "conflicting");
  assert.match(report.review[0].action, /Reconcile/);
  assert.equal(report.remainingReviewItems, 2);
});

test("wrong office, unscoped, future, private-like or unsupported evidence stays unknown", () => {
  const mutations = [
    (r: ReturnType<typeof fixture>) => {
      r.providerId = "another-office";
    },
    (r: ReturnType<typeof fixture>) => {
      r.facts[0].publicOfficeFact!.officeAddress = "Another office";
    },
    (r: ReturnType<typeof fixture>) => {
      r.facts[0].publicOfficeFact!.officeZip = "00000";
    },
    (r: ReturnType<typeof fixture>) => {
      delete r.facts[0].publicOfficeFact;
    },
    (r: ReturnType<typeof fixture>) => {
      r.sources[0].checkedAt = "2026-11-19";
    },
    (r: ReturnType<typeof fixture>) => {
      r.sources[0].checkedAt = "2026-02-30";
    },
    (r: ReturnType<typeof fixture>) => {
      r.sources[0].kind = "public-discussion";
    },
    (r: ReturnType<typeof fixture>) => {
      r.sources[0].access = "search-result";
    },
    (r: ReturnType<typeof fixture>) => {
      r.sources[0].url = "mailto:family@example.com";
    },
    (r: ReturnType<typeof fixture>) => {
      r.sources[0].excerpt = "Request a consultation";
    },
  ];
  for (const mutate of mutations) {
    const research = fixture();
    mutate(research);
    assert.equal(
      publicOfficeEvidence(office, research, "2026-11-18")!.find(
        (fact) => fact.field === "minimum-hours",
      )!.state,
      "unknown",
    );
  }
  assert.equal(
    publicOfficeEvidence({ ...office, category: "home-health" }),
    null,
  );
  assert.equal(publicOfficeEvidence({ ...office, state: "MA" }), null);
  assert.equal(publicOfficeEvidence({ ...office, locationKind: "zip" }), null);
});

test("start claim expires daily, office ZIP is never inferred as service coverage, and private state is ignored", () => {
  const research = fixture(["Earliest start is November 20."]);
  research.facts[0].publicOfficeFact!.field = "earliest-start";
  assert.equal(
    publicOfficeEvidence(office, research, "2026-11-18")!.find(
      (fact) => fact.field === "earliest-start",
    )!.state,
    "known",
  );
  assert.equal(
    publicOfficeEvidence(office, research, "2026-11-19")!.find(
      (fact) => fact.field === "earliest-start",
    )!.state,
    "stale",
  );
  const before = structuredClone(office);
  const withPrivateExtra = {
    ...research,
    consultation: {
      confirmed: true,
      startsAt: "2026-11-19",
      familyEmail: "family@example.com",
    },
  };
  const result = publicOfficeEvidence(
    { ...office, serviceAreaZips: [office.zip], sources: [] },
    withPrivateExtra,
    "2026-11-18",
  )!;
  assert.equal(
    result.find((fact) => fact.field === "service-zips")!.state,
    "unknown",
  );
  assert.doesNotMatch(JSON.stringify(result), /family@example/);
  assert.deepEqual(office, before);
});

test("coordinator queue is bounded and counts every stale released fact without outreach", () => {
  const report = officeEvidenceReview(providers, {}, "2027-03-01", 3);
  assert.equal(report.counts.intake.stale, 9);
  assert.equal(report.counts["service-zips"].stale, 9);
  assert.equal(report.review.length, 3);
  assert.ok(
    report.review.every(
      (item) => item.reason === "stale" && item.sources.length,
    ),
  );
  assert.equal(report.remainingReviewItems, report.totalReviewItems - 3);
  assert.equal(
    officeEvidenceReview(providers, {}, "2027-03-01", 1000).review.length,
    100,
  );
});

test("provider details render actual office routes without loaded location research, with grouped unknowns", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-11-18T12:00:00Z"),
  });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const require = createRequire(import.meta.url);
  require.extensions[".css"] = () => {};
  const {
    LocationResearch,
  }: typeof import("../src/components/location-research") = require("../src/components/location-research");
  const html = renderToStaticMarkup(
    createElement(LocationResearch, {
      provider: office,
      onTask: () => true,
      navigation: { pane: "details" },
      uid: "office-proof",
    }),
  );
  assert.match(html, /Public office planning facts/);
  assert.match(html, /Office inquiry route published/);
  assert.match(
    html,
    /minimum hours, earliest care start, published service zips/,
  );
  assert.match(html, /morris-county-10005/);
  assert.equal((html.match(/Unknown:/g) ?? []).length, 1);
});

test("mixed-date intake routes cannot borrow freshness and stale siblings remain queued", () => {
  const entry = inquiryRoutes.offices["north-jersey-hp-hp0015347"];
  const original = entry.routes;
  const route = original[0];
  try {
    entry.routes = [
      {
        ...route,
        href: "https://www.bayada.com/fresh",
        checkedAt: "2026-11-18",
      },
      {
        ...route,
        href: "https://www.bayada.com/old",
        sourceUrl: "https://www.bayada.com/old-source",
        checkedAt: "2026-10-01",
      },
      {
        ...route,
        href: "https://www.bayada.com/future",
        checkedAt: "2026-11-19",
      },
      {
        ...route,
        href: "https://www.bayada.com/invalid",
        checkedAt: "2026-02-30",
      },
      { ...route, href: "javascript:alert(1)", checkedAt: "2026-11-18" },
    ];
    const fact = publicOfficeEvidence(office, undefined, "2026-11-18")![0];
    assert.equal(fact.state, "known");
    assert.equal(fact.value, "https://www.bayada.com/fresh");
    assert.equal(fact.sources.length, 1);
    assert.equal(fact.sources[0].destination, "https://www.bayada.com/fresh");
    assert.equal(fact.sources[0].expiresAt, "2026-12-18");
    assert.equal(fact.staleSources?.length, 1);
    assert.equal(
      fact.staleSources![0].destination,
      "https://www.bayada.com/old",
    );
    assert.equal(fact.staleSources![0].expiresAt, "2026-10-31");
    assert.doesNotMatch(JSON.stringify(fact), /future|invalid|javascript/);
    const report = officeEvidenceReview([office], {}, "2026-11-18", 1);
    assert.equal(report.counts.intake.known, 1);
    assert.equal(report.staleIntakeRoutes, 1);
    assert.equal(report.review[0].field, "intake");
    assert.equal(report.review[0].reason, "stale");
    assert.equal(
      report.review[0].sources[0].destination,
      "https://www.bayada.com/old",
    );
    assert.equal(report.review[0].sources[0].checkedAt, "2026-10-01");
  } finally {
    entry.routes = original;
  }
});
