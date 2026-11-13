import assert from "node:assert/strict";
import test from "node:test";
import { comparisonDemo } from "../src/components/dashboard/comparison-demo";
import { GET } from "../src/app/api/providers/route";
import { getLocationResearch } from "../src/lib/location-research";
import type { Provider } from "../src/lib/providers";

test("the shareable demo resolves exactly the published North Jersey pair", async () => {
  const url = new URL(comparisonDemo.href, "http://localhost");
  assert.equal(url.pathname, "/dashboard");
  assert.equal(url.searchParams.get("demo"), "1");
  assert.equal(
    url.searchParams.get(comparisonDemo.selector.parameter),
    comparisonDemo.selector.value,
  );
  const response = GET(
    new Request(
      `http://localhost/api/providers?${new URLSearchParams({
        ids: comparisonDemo.providerIds.join(","),
        market: "north-jersey",
      })}`,
    ),
  );
  const { providers }: { providers: Provider[] } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["north-jersey-doh-nj13a012", "north-jersey-doh-nj60a001"],
  );
  for (const provider of providers) {
    assert.equal(provider.state, "NJ");
    assert.equal(provider.category, "assisted-living");
    assert.ok((provider.research?.individualReviews?.withText ?? 0) >= 4);
    assert.ok((provider.research?.experience.reviewCount ?? 0) >= 30);
    assert.equal(provider.research?.experience.independentSourceCount, 1);
    const research = getLocationResearch(provider.id);
    assert.ok(research.reviews.some((review) => review.excerpt));
    assert.ok(
      research.facts.some(
        (fact) => fact.kind === "care" && /memory care/i.test(fact.text),
      ),
    );
    const costs = research.facts.filter((fact) => fact.kind === "cost");
    assert.equal(costs.length, 3);
    for (const cost of costs)
      assert.ok(
        research.sources.some(
          (source) => source.id === cost.sourceId && source.kind === "provider",
        ),
      );
  }
  const [arbor, brighton] = providers.map((provider) =>
    getLocationResearch(provider.id),
  );
  assert.equal(
    arbor.facts.find((fact) => fact.kind === "cost")?.amount?.min,
    6915,
  );
  assert.equal(
    brighton.facts.find((fact) => fact.kind === "cost")?.amount?.min,
    4500,
  );
  assert.ok(arbor.facts.some((fact) => /bridges program/i.test(fact.text)));
  assert.ok(brighton.facts.some((fact) => /short-term stays/i.test(fact.text)));
});
