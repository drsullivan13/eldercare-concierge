import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useCareSearch } from "../src/hooks/use-care-search";
import { createEmptyWorkspace } from "../src/lib/workspace";
import type { CareCategory } from "../src/lib/providers";

for (const { careTypes, category } of [
  { careTypes: [], category: "home-care" },
  { careTypes: ["home-care"], category: "home-care" },
  { careTypes: ["assisted-living"], category: "assisted-living" },
  { careTypes: ["home-health"], category: "home-health" },
  { careTypes: ["nursing-home", "home-care"], category: "all" },
] satisfies { careTypes: CareCategory[]; category: string }[]) {
  test(`dashboard initializes ${careTypes.join(", ") || "no preferences"} without changing the profile`, () => {
    const profile = {
      ...createEmptyWorkspace().profile,
      zip: "07960",
      careTypes,
    };
    const before = structuredClone(profile);
    let observed: ReturnType<typeof useCareSearch> | undefined;
    function Probe() {
      observed = useCareSearch(profile);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    assert.equal(observed?.draft.category, category);
    assert.equal(observed?.request.category, category);
    assert.equal(observed?.request.zip, "07960");
    assert.deepEqual(profile, before);
  });
}

test("the existing search API caller still defaults to all categories", async () => {
  const { GET } = await import("../src/app/api/search/route");
  const response = GET(
    new Request("http://localhost/api/search?zip=07928&radius=25"),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.providers.some((p: { category: string }) => p.category === "home-care"));
  assert.ok(result.providers.some((p: { category: string }) => p.category === "assisted-living"));
  assert.ok(result.providers.some((p: { category: string }) => p.category === "home-health"));
});

test("Morristown BAYADA keeps its exact branch ratings separate from certified home health", async () => {
  const { searchProviders } = await import("../src/lib/search");
  const { getHomeHealthEvidence } = await import("../src/lib/home-health");
  const result = searchProviders({
    zip: "07960",
    radius: 25,
    category: "home-care",
    q: "BAYADA",
  });
  const branch = result.providers.find(
    (p) => p.id === "north-jersey-hp-hp0015347",
  );
  assert.ok(branch);
  assert.equal(branch.city, "MORRISTOWN");
  assert.equal(branch.address, "32 MAPLE AVENUE,1ST FL");
  assert.equal(branch.category, "home-care");
  assert.equal(branch.research?.experience.value, null);
  assert.equal(branch.research?.experience.reviewCount, 6);
  assert.equal(branch.research?.experience.singleSourceLabel, "Google");
  assert.equal(branch.cms, undefined);
  assert.ok(!result.providers.some((p) => p.id === "cms-317002"));
  assert.throws(() => getHomeHealthEvidence(branch.id), /No matched CMS/);
  const certified = getHomeHealthEvidence("cms-317002");
  assert.deepEqual(certified.agencies.map((a) => a.ccn), ["317002"]);
  assert.equal(certified.providerId, "cms-317002");
});

test("home-care matching retains secondary categories and ZIP estimates without claiming coverage", async () => {
  const { searchProviders } = await import("../src/lib/search");
  const nj = searchProviders({ zip: "07928", radius: 25, category: "home-care" });
  const estimate = nj.providers.find((p) => p.id === "north-jersey-hp-hp0134800");
  assert.ok(estimate);
  assert.equal(estimate.locationKind, "zip");
  assert.equal(estimate.distanceMiles, 0);
  assert.ok(nj.providers.every((p) => p.category === "home-care" || p.searchCategories?.includes("home-care")));
  const ma = searchProviders({ zip: "02459", radius: 50, category: "home-care" });
  const secondary = ma.providers.find((p) => p.id === "all-care");
  assert.ok(secondary);
  assert.notEqual(secondary.category, "home-care");
  assert.ok(secondary.searchCategories?.includes("home-care"));
});
