import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getReviewCatalog } from "../src/lib/review-catalog";
import type { ReviewCatalog } from "../src/lib/review-catalog-types";

const snapshot = JSON.parse(
  readFileSync(resolve("src/data/review-catalog.json"), "utf8"),
) as Record<string, ReviewCatalog>;

test("reader returns each exact provider catalog without projecting into scores", () => {
  for (const [id, record] of Object.entries(snapshot)) {
    assert.equal(record.providerId, id);
    assert.deepEqual(getReviewCatalog(id), record);
    assert.ok(!Object.hasOwn(record, "score"));
    assert.ok(!Object.hasOwn(record, "rating"));
  }
});

test("unknown and inherited keys never resolve to another provider", () => {
  for (const id of [
    "unknown",
    "",
    "constructor",
    "__proto__",
    "cms-315000/../",
  ]) {
    assert.equal(getReviewCatalog(id), null);
  }
});

test("callers cannot mutate the retained catalog", () => {
  const id = Object.keys(snapshot).find((id) => snapshot[id].accounts.length)!;
  const first = getReviewCatalog(id)!;
  first.accounts[0].url = "https://example.org/changed";
  first.sources.splice(0);
  first.notes.push("changed");
  assert.deepEqual(getReviewCatalog(id), snapshot[id]);
});

test("sources distinguish reported ratings from acquired original records", () => {
  for (const record of Object.values(snapshot)) {
    assert.equal(
      new Set(record.accounts.map((a) => a.id)).size,
      record.accounts.length,
    );
    for (const source of record.sources) {
      assert.equal(
        source.retainedCount,
        record.accounts.filter((a) => a.sourceId === source.id).length,
      );
      assert.ok(source.previouslyUnseenCount <= source.retainedCount);
      assert.ok(source.pagesChecked <= 20);
      assert.ok(source.url.startsWith("https://"));
    }
    for (const account of record.accounts) {
      assert.ok(record.sources.some((s) => s.id === account.sourceId));
      if (account.representation === "link-only") {
        assert.equal(account.excerpt, null);
        assert.equal(account.summary, null);
      } else {
        assert.equal(account.representation, "reviewed-excerpt");
        if (account.provenance === "new-public-page") {
          assert.equal(account.excerpt, null);
          assert.ok(account.summary && account.summary.length <= 300);
        } else {
          assert.equal(account.provenance, "retained-reviewed");
          assert.ok(account.excerpt && account.excerpt.length <= 240);
        }
      }
      assert.ok(!Object.hasOwn(account, "author"));
      assert.ok(!Object.hasOwn(account, "body"));
    }
  }
});

test("the real 38-count mixed listing supplies four exact nursing accounts, not 38", () => {
  const record = getReviewCatalog("cms-225281")!;
  const source = record.sources.find((s) =>
    s.url.endsWith("/skilled-nursing-facility-at-north-hill-the"),
  )!;
  assert.equal(source.reportedCount, 38);
  assert.equal(source.retainedCount, 4);
  assert.equal(source.pagesChecked, 1);
  assert.match(
    source.scopeNote ?? "",
    /38 ratings across North Hill.*Pines Edge/,
  );
  assert.match(source.scopeNote ?? "", /four accounts shown.*Pines Edge rehab/);
  assert.match(
    source.scopeNote ?? "",
    /broader source.*not.*nursing-unit rating.*score/,
  );
  assert.doesNotMatch(
    source.scopeNote ?? "",
    /release only|do not assign|copy its aggregate/i,
  );
  assert.equal(
    record.accounts.filter((a) => a.sourceId === source.id).length,
    4,
  );
  assert.ok(
    !record.accounts.some((a) => a.nativeReviewId === "mlc-external-301320"),
  );
});

test("approved retained aliases resolve to one stable account with its original link history", () => {
  const aliases = JSON.parse(
    readFileSync(
      resolve("research/massachusetts/review-catalog/retained-aliases.json"),
      "utf8",
    ),
  ) as { providerId: string; retainedReviewId: string; nativeId: string }[];
  for (const alias of aliases) {
    const record = getReviewCatalog(alias.providerId)!;
    const matches = record.accounts.filter(
      (a) => a.id === alias.retainedReviewId,
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].nativeReviewId, alias.nativeId);
    assert.equal(matches[0].retainedReview?.id, alias.retainedReviewId);
    assert.ok(matches[0].retainedReview?.url.startsWith("https://"));
  }
});

test("new readable accounts contain only their exact approved provider-linked paraphrase", () => {
  const overlay = JSON.parse(
    readFileSync(
      resolve("research/north-jersey/review-catalog-editorial/overlay.json"),
      "utf8",
    ),
  ) as {
    pages: {
      providerId: string;
      rows: { id: string; publication: string; paraphrase?: string }[];
    }[];
  };
  const approved = new Map<string, string>();
  for (const page of overlay.pages) {
    for (const row of page.rows) {
      if (row.publication === "released" && row.paraphrase)
        approved.set(`${page.providerId}|${row.id}`, row.paraphrase);
    }
  }
  const ma = JSON.parse(
    readFileSync(
      resolve("research/massachusetts/review-catalog/reviewed.json"),
      "utf8",
    ),
  ) as { accounts: Record<string, { summary?: string; exclude?: string }> };
  const maCatalog = JSON.parse(
    readFileSync(
      resolve("research/massachusetts/review-catalog/catalog.json"),
      "utf8",
    ),
  ) as Record<string, ReviewCatalog>;
  for (const [pid, record] of Object.entries(snapshot)) {
    for (const account of record.accounts) {
      if (account.provenance !== "new-public-page" || !account.summary)
        continue;
      assert.equal(account.excerpt, null);
      assert.ok(account.nativeReviewId);
      const summary = approved.get(`${pid}|${account.nativeReviewId}`);
      if (summary) {
        assert.equal(account.summary, summary);
      } else {
        const decision = ma.accounts[account.nativeReviewId!];
        assert.ok(decision && !decision.exclude);
        assert.equal(account.summary, decision.summary);
        assert.ok(maCatalog[pid].accounts.some((a) => a.url === account.url));
      }
    }
  }
});
