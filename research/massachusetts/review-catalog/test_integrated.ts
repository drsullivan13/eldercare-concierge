import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getReviewCatalog } from "../../../src/lib/review-catalog";
import type { ReviewCatalog } from "../../../src/lib/review-catalog-types";
import { GET } from "../../../src/app/api/reviews/route";

test("all acquired Massachusetts accounts resolve once through the published reader", () => {
  const feed = JSON.parse(
    readFileSync(new URL("./catalog.json", import.meta.url), "utf8"),
  ) as Record<string, ReviewCatalog>;
  let checked = 0;
  for (const [providerId, expected] of Object.entries(feed)) {
    const actual = getReviewCatalog(providerId);
    assert.ok(actual, providerId);
    for (const row of expected.accounts) {
      const matches: ReviewCatalog["accounts"] = actual.accounts.filter(
        (account) => account.nativeReviewId === row.nativeReviewId,
      );
      assert.equal(matches.length, 1, `${providerId} ${row.nativeReviewId}`);
      assert.equal(matches[0].summary, row.summary);
      assert.equal(matches[0].date, row.date);
      checked++;
    }
  }
  assert.equal(checked, 101);
  const northHill = getReviewCatalog("cms-225281");
  assert.equal(northHill?.accounts.length, 4);
  assert.equal(
    getReviewCatalog("ma-alr-the-falls-at-cordingly-dam")?.accounts.length,
    9,
  );
});

test("North Hill's normal response explains the broader source without attributing its ratings to rehab", async () => {
  const response = GET(
    new Request("http://localhost/api/reviews?id=cms-225281"),
  );
  assert.equal(response.status, 200);
  const reviews = await response.json();
  assert.equal(reviews.providerId, "cms-225281");
  assert.equal(reviews.accounts.length, 4);
  const source = reviews.sources.find(
    (source: { id: string }) =>
      source.id === "mlc-skilled-nursing-facility-at-north-hill-the",
  );
  assert.equal(source.reportedCount, 38);
  assert.equal(source.retainedCount, 4);
  assert.match(source.scopeNote, /38 ratings across North Hill.*Pines Edge/);
  assert.match(source.scopeNote, /four accounts shown.*Pines Edge rehab/);
  assert.match(source.scopeNote, /broader source.*not.*nursing-unit rating.*score/);
  assert.ok(reviews.notes.includes(source.scopeNote));
  assert.doesNotMatch(
    JSON.stringify([reviews.notes, reviews.sources]),
    /release only|do not assign|copy its aggregate/i,
  );
  for (const account of reviews.accounts) {
    assert.equal(account.sourceId, source.id);
    assert.match(account.summary, /Pines Edge/);
    assert.equal(account.rating, null);
    assert.equal(account.scale, null);
  }
});
