import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMarket } from "../src/lib/markets";
import {
  getHomeHealthEvidence,
  njHomeHealthSurvey,
} from "../src/lib/home-health";
import { getProvidersByIds, searchProviders } from "../src/lib/search";
import type { SearchProvider } from "../src/lib/providers";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const {
  ProviderCard,
}: typeof import("../src/components/provider-card") = require("../src/components/provider-card");
const market = getMarket("north-jersey")!;
const snapshot = market.homeHealthEvidence!;
const render = (provider: SearchProvider) =>
  renderToStaticMarkup(
    createElement(ProviderCard, {
      provider,
      saved: false,
      onSave() {},
      onOpen() {},
      onReviews() {},
    }),
  );

test("NJ agency search and saved cards use the published CMS survey values and preserve consumer scores", () => {
  let fallbackCount = 0;
  const providers = getProvidersByIds(
    snapshot.agencies.map((a) => a.organizationId),
  );
  assert.equal(providers.length, 18);
  for (const saved of providers) {
    const provider = searchProviders(
      { zip: saved.zip, category: "home-health", radius: 25 },
      [saved],
    ).providers[0];
    const { patientExperience: survey } = getHomeHealthEvidence(saved.id)
      .agencies[0];
    const result = provider.research!;
    const card = render(provider);
    assert.deepEqual(result.homeHealthSurvey, {
      stars: survey.summaryStarRating.value,
      completed: survey.completedSurveys.value,
      smallSample: survey.generalFootnoteCodes.includes("11"),
    });
    assert.deepEqual(saved.research?.homeHealthSurvey, result.homeHealthSurvey);
    assert.equal(card.match(/class="provider-review-entry"/g)?.length, 1);
    if (result.experience.value !== null) {
      assert.match(card, /Consumer experience/);
      assert.doesNotMatch(card, /CMS patient survey/);
      continue;
    }
    fallbackCount++;
    assert.match(card, /CMS patient survey/);
    assert.ok(
      card.includes(
        `<strong>${survey.summaryStarRating.value}<small>/5</small>`,
      ),
    );
    assert.ok(
      card.includes(
        `${survey.completedSurveys.value!.toLocaleString("en-US")} completed surveys`,
      ),
    );
    assert.equal(
      card.includes("Small sample"),
      result.homeHealthSurvey!.smallSample,
    );
    assert.ok(card.includes("View survey &amp; review sources"));
    const disputed = render({
      ...provider,
      research: {
        ...result,
        experience: {
          ...result.experience,
          publicationStatus: "sources-disagree",
        },
      },
    });
    assert.match(disputed, /Sources disagree/);
    assert.doesNotMatch(disputed, /CMS patient survey/);
  }
  assert.equal(fallbackCount, 15);
});

test("only exact official agency surveys with displayable stars, counts and qualifications qualify", () => {
  const agency = snapshot.agencies[0],
    provider = market.providers.find((p) => p.id === agency.organizationId)!;
  for (const candidate of [
    { ...provider, id: "north-jersey-hp-hp0015320" },
    { ...provider, category: "home-care" as const },
    { ...provider, state: "MA" },
    { ...provider, officialRecord: false },
  ])
    assert.equal(njHomeHealthSurvey(candidate, market), undefined);
  const only = (agencies: typeof snapshot.agencies) => ({
    ...market,
    homeHealthEvidence: { ...snapshot, agencies },
  });
  for (const wrong of [
    [],
    [agency, agency],
    [{ ...agency, ccn: "317099" }],
    [{ ...agency, cmsAddress: { ...agency.cmsAddress, state: "MA" } }],
  ])
    assert.equal(njHomeHealthSurvey(provider, only(wrong)), undefined);
  const survey = agency.patientExperience;
  const countAtThreshold = { ...survey.completedSurveys, value: 40 };
  assert.equal(
    njHomeHealthSurvey(
      provider,
      only([{ ...agency, patientExperience: { ...survey, completedSurveys: countAtThreshold } }]),
    )?.completed,
    40,
  );
  for (const changes of [
    { generalFootnoteCodes: ["unknown"] },
    { datasetId: "unrelated" },
    { summaryStarRating: { ...survey.summaryStarRating, value: null } },
    { summaryStarRating: { ...survey.summaryStarRating, value: 6 } },
    { completedSurveys: { ...survey.completedSurveys, value: 39 } },
    {
      completedSurveys: {
        ...survey.completedSurveys,
        status: "not published" as const,
      },
    },
  ])
    assert.equal(
      njHomeHealthSurvey(
        provider,
        only([{ ...agency, patientExperience: { ...survey, ...changes } }]),
      ),
      undefined,
    );
});
