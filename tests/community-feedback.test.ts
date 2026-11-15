import test from "node:test";
import assert from "node:assert/strict";
import interviews from "../research/north-jersey/review-catalog-editorial/resident-interview-profiles.json";
import distinctions from "../research/north-jersey/review-catalog-editorial/sunrise-survey-distinctions.json";
import { getCommunityFeedback } from "../src/lib/review-catalog";
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
  for (const row of distinctions.records) {
    const result = getCommunityFeedback(row.providerId);
    assert.deepEqual(result.surveyDistinction, {
      year: distinctions.year,
      categories: row.categories,
      sourceUrl: distinctions.sourceUrl,
    });
  }
  assert.deepEqual(getCommunityFeedback("cms-315120"), {});
  assert.deepEqual(getCommunityFeedback("unknown"), {});
});
