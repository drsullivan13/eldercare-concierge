import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getReviewCatalog } from "../../../src/lib/review-catalog";
import type { ReviewCatalog } from "../../../src/lib/review-catalog-types";

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
  assert.match(
    northHill?.sources.find(
      (source) => source.id === "mlc-skilled-nursing-facility-at-north-hill-the",
    )?.scopeNote ?? "",
    /mixed-scope/,
  );
  assert.equal(
    getReviewCatalog("ma-alr-the-falls-at-cordingly-dam")?.accounts.length,
    9,
  );
});
