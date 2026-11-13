import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Methodology from "../src/app/methodology/page";
import { EvidenceStandards } from "../src/components/dashboard/research-standards";
import { ExperienceExplanation } from "../src/components/experience-explanation";
import { FamilyExperienceEvidence } from "../src/components/family-experience";
import { ResearchDisclosure } from "../src/components/dashboard/research-disclosure";
import { searchProviders } from "../src/lib/search";
import { getLocationResearch } from "../src/lib/location-research";
import { publicLocationResearch } from "../src/lib/public-location-research";

test("public research explanations retain source context without disclosing scoring rules", () => {
  const detail = publicLocationResearch(
    getLocationResearch("lifeplan-brooksby-village", "2026-11-12"),
  );
  const surfaces = [
    createElement(Methodology),
    createElement(EvidenceStandards),
    createElement(ExperienceExplanation, { data: detail, uid: "test" }),
    createElement(FamilyExperienceEvidence, {
      evidence: detail.familyExperience,
    }),
    createElement(ResearchDisclosure, {
      data: searchProviders({ zip: "02459", radius: 50 }),
      filtered: true,
    }),
  ];
  for (const surface of surfaces) {
    const text = renderToStaticMarkup(surface)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    assert.doesNotMatch(
      text,
      /square root|weighted|threshold|EXPERIENCE V2|The calculation|Publication requirements|180 days|365 days|730 days|30 reported|five each|two or more points|ordered by thread count|scores tie|sorting tied scores|same published score/i,
    );
  }
  const text = renderToStaticMarkup(
    createElement(ExperienceExplanation, { data: detail, uid: "test" }),
  );
  assert.match(text, /44 source-reported ratings/);
  assert.match(text, /Published rating/);
  assert.match(text, /Rating scope/);
  assert.match(text, /Reviewers are not independently authenticated/);
  assert.match(text, /not a clinical-quality or safety score/);
  assert.match(text, /href="https:/);
});
