import test from "node:test";
import assert from "node:assert/strict";
import interviews from "../research/north-jersey/review-catalog-editorial/resident-interview-profiles.json";
import sunrise from "../research/north-jersey/review-catalog-editorial/sunrise-survey-distinctions.json";
import brookdale from "../research/north-jersey/review-catalog-editorial/brookdale-survey-distinctions.json";
import brightview from "../research/north-jersey/review-catalog-editorial/brightview-survey-distinctions.json";
import benchmark from "../research/north-jersey/review-catalog-editorial/benchmark-survey-distinctions.json";
import mixedRanks from "../research/north-jersey/review-catalog-editorial/home-care-mixed-survey-ranks.json";
import activated from "../research/north-jersey/review-catalog-editorial/wyckoff-activated-insights.json";
import { getLocationFeedback } from "../src/lib/review-catalog";
import { searchProviders, getProvidersByIds } from "../src/lib/search";
import { GET as getResearch } from "../src/app/api/research/route";
import { GET } from "../src/app/api/reviews/route";

test("each community's Reviews response preserves its source and survey setting", async () => {
  for (const row of interviews.records) {
    const data = await GET(
      new Request("https://harbor.test/api/reviews?id=" + row.providerId),
    ).json();
    assert.equal(data.interviewUrl, row.url);
    assert.ok(
      !data.accounts.some((item: { url: string }) => item.url === row.url),
    );
  }
  for (const distinctions of [sunrise, brightview, brookdale, benchmark])
    for (const row of distinctions.records) {
      const result = getLocationFeedback(row.providerId);
      assert.deepEqual(result.surveyDistinction, {
        year: distinctions.year,
        categories: row.categories,
        sourceUrl: distinctions.sourceUrl,
      });
    }
  assert.deepEqual(getLocationFeedback("cms-315120"), {});
  for (const row of mixedRanks.records) {
    assert.deepEqual(getLocationFeedback(row.providerId).mixedSurveyRank, {
      year: mixedRanks.year,
      surveyPeriod: mixedRanks.surveyPeriod,
      rank: row.rank,
      sourceUrl: row.sourceUrl,
    });
  }
  assert.deepEqual(getLocationFeedback("north-jersey-hp-hp0358100"), {});
  assert.deepEqual(getLocationFeedback("unknown"), {});
  assert.deepEqual(
    getLocationFeedback(activated.awards[0].providerId).serviceDistinction,
    {
      year: activated.awardYear,
      categories: activated.awards[0].categories,
      sourceUrl: activated.operatorRelease,
    },
  );
  assert.deepEqual(getLocationFeedback("cms-315376"), {});
  assert.deepEqual(
    getLocationFeedback("north-jersey-campus-the-vista-07481"),
    {},
  );
});

test("The Vista's survey and starting fees belong only to its independent-living campus", async () => {
  const id = "north-jersey-campus-the-vista-07481";
  const result = searchProviders({
    zip: "07481",
    category: "life-plan",
    radius: 10,
  });
  const campus = result.providers.find((item) => item.id === id);
  assert.ok(campus);
  assert.deepEqual(campus.research?.residentEngagement, {
    index: 8,
    maximum: 8,
    year: 2026,
    respondents: 171,
    eligibleResidents: 203,
    sourceId: "vista-survey",
  });
  const [saved] = getProvidersByIds([id]);
  assert.deepEqual(
    saved.research?.residentEngagement,
    campus.research.residentEngagement,
  );
  assert.equal(campus.research.experience.value, null);
  const detail = await getResearch(
    new Request("https://harbor.test/api/research?id=" + id),
  ).json();
  assert.deepEqual(
    detail.residentEngagement,
    campus.research.residentEngagement,
  );
  assert.equal(
    detail.sources.find(
      (s: { id: string }) => s.id === detail.residentEngagement.sourceId,
    ).publisher,
    "The Vista",
  );
  assert.deepEqual(
    detail.facts
      .filter((f: { amount?: object }) => f.amount)
      .map((f: { amount: { min: number; period: string } }) => [
        f.amount.min,
        f.amount.period,
      ]),
    [
      [269900, "one-time"],
      [4128, "month"],
    ],
  );
  const others = searchProviders({
    zip: "07481",
    category: "all",
    radius: 10,
  }).providers.filter((p) => p.id !== id);
  assert.ok(others.length);
  assert.ok(others.every((p) => p.research?.residentEngagement === undefined));
});
