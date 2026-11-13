import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { markets } from "../src/lib/markets";
import { getLocationResearch } from "../src/lib/location-research";
import {
  publicLocationResearch,
  publicResearchNotes,
} from "../src/lib/public-location-research";
import { publicExperience } from "../src/lib/public-experience";
import {
  getResearchCoverage,
  researchCoverageCsv,
  publicResearchCoverageCsv,
} from "../src/lib/research-coverage";
import { GET as researchGET } from "../src/app/api/research/route";
import { GET as reviewsGET } from "../src/app/api/reviews/route";
import { GET as searchGET } from "../src/app/api/search/route";
import { GET as providersGET } from "../src/app/api/providers/route";
import { GET as coverageGET } from "../src/app/api/research-coverage/route";

const forbiddenKeys = new Set([
  "methodVersion",
  "includedSources",
  "excludedSources",
  "normalizedRating",
  "weight",
  "weights",
  "sampleDiagnostics",
  "narrativeDiagnostics",
  "aggregateRange",
  "reviewSamples",
  "sourceFamily",
  "eligibleReviews",
  "sourceFamilies",
  "facebookWithheldObservations",
]);
const forbiddenText =
  /square root|weighted (?:average|calculation|result)|eligibility threshold|10-review threshold|30 reported reviews from one family|180 days|365 days|730 days|source-family .*deduplicate|numeric (?:experience )?scor(?:e|ing)/i;
const scoreKeys = [
  "label",
  "value",
  "reviewCount",
  "independentSourceCount",
  "confidence",
  "publicationStatus",
  "singleSourceLabel",
  "selectedConcerns",
];

function assertPublic(value: unknown, path = "payload"): void {
  if (typeof value === "string") {
    assert.doesNotMatch(value, forbiddenText, path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => assertPublic(item, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `${path}.${key}`);
      if (key === "experience") {
        assert.ok(item && typeof item === "object");
        assert.ok(
          Object.keys(item).every((key) => scoreKeys.includes(key)),
          path,
        );
      }
      assertPublic(item, `${path}.${key}`);
    }
  }
}

test("complete public research, reviews, search, saved-provider and coverage responses omit score internals in both markets", async () => {
  for (const market of markets) {
    for (const provider of market.providers) {
      for (const [route, handler] of [
        ["research", researchGET],
        ["reviews", reviewsGET],
      ] as const) {
        const response = handler(
          new Request(`http://localhost/api/${route}?id=${provider.id}`),
        );
        assert.equal(response.status, 200);
        assertPublic(await response.json(), `${route}.${provider.id}`);
      }
    }
    for (const [route, handler] of [
      [`search?zip=${market.defaultZip}&radius=50`, searchGET],
      [
        `providers?ids=${market.providers
          .slice(0, 2)
          .map((p) => p.id)
          .join(",")}`,
        providersGET,
      ],
      [`research-coverage?market=${market.id}`, coverageGET],
    ] as const) {
      const response = handler(new Request(`http://localhost/api/${route}`));
      assert.equal(response.status, 200);
      assertPublic(await response.json(), route);
    }
    const csv = await coverageGET(
      new Request(
        `http://localhost/api/research-coverage?market=${market.id}&format=csv`,
      ),
    ).text();
    assertPublic(csv);
    assert.doesNotMatch(
      csv,
      /eligible_reported_reviews|source_families|too-few-reviews|source-check-needed|withheld_observations/,
    );
  }
});

test("public projections drop extra score fields and private notes without mutating founder evidence", () => {
  const internal = getLocationResearch(
    "lifeplan-brooksby-village",
    "2026-11-12",
  );
  const before = structuredClone(internal);
  assert.ok(internal.experience.includedSources[0].weight > 0);
  assert.equal(internal.experience.methodVersion, "2.0");
  assert.ok(internal.experience.reason.length);
  assert.ok(internal.experience.limitations.length);
  assert.deepEqual(
    Object.keys(publicExperience(internal.experience)).sort(),
    scoreKeys.toSorted(),
  );
  const projected = publicLocationResearch({
    ...internal,
    notes: [
      "Known care-unit scope remains unresolved. Below 10-review threshold; no experience score.",
    ],
    experience: {
      ...internal.experience,
      ...{ futureSecretDiagnostic: "private" },
    },
  });
  assert.deepEqual(projected.notes, [
    "Known care-unit scope remains unresolved.",
  ]);
  assertPublic(projected);
  assert.deepEqual(
    projected.reviewAggregates.map(
      ({ rating, scale, count, scope, sourceId }) => ({
        rating,
        scale,
        count,
        scope,
        sourceId,
      }),
    ),
    internal.reviewAggregates.map(
      ({ rating, scale, count, scope, sourceId }) => ({
        rating,
        scale,
        count,
        scope,
        sourceId,
      }),
    ),
  );
  assert.deepEqual(internal, before);
});

test("private scoring clauses do not erase source identity, access limits or care eligibility", () => {
  const notes = publicResearchNotes([
    "Home-health Medicare eligibility and private-duty personal care are different offers.",
    "Index identifies 18 Frances Street, Woburn 01801 and exact nursing-facility name.",
    "Full-page open returned HTTP 403; no bypass attempted. Indexed profile also combines Assisted Living and Nursing Homes, unresolved unit scope; not score eligible.",
    "All-time overall experience average 3.3 out of 5, distinct from proprietary 1 out of 10 review score. Only one review in last two years; historic aggregate may not describe current care.",
    "Do not score: correct Newton address, but the same listing includes a review explicitly naming Sunrise of Alexandria.",
    "APFM and SeniorAdvisor share a source family; do not double-count syndication.",
  ]).join(" ");
  assert.match(notes, /Medicare eligibility/);
  assert.match(notes, /18 Frances Street/);
  assert.match(notes, /HTTP 403/);
  assert.match(
    notes,
    /combines Assisted Living and Nursing Homes, unresolved unit scope/,
  );
  assert.match(notes, /3.3 out of 5, distinct from proprietary 1 out of 10/);
  assert.match(notes, /historic aggregate may not describe current care/);
  assert.match(notes, /Sunrise of Alexandria/);
  assert.doesNotMatch(
    notes,
    /score eligible|Do not score|source family|double-count/i,
  );
  const unresolved = publicLocationResearch(getLocationResearch("cms-225191"));
  assert.match(
    unresolved.reviewAggregates[0].notes.join(" "),
    /unresolved unit scope/,
  );
  const homeCare = publicLocationResearch(
    getLocationResearch("abc-home-healthcare"),
  );
  assert.match(homeCare.notes.join(" "), /Medicare eligibility/);
  const average = publicLocationResearch(getLocationResearch("cms-225223"));
  assert.match(
    average.reviewAggregates[0].notes.join(" "),
    /distinct from proprietary 1 out of 10/,
  );
});

test("founder CSV retains internal review actions while public downloads omit them", () => {
  const coverage = getResearchCoverage("2026-11-12");
  const internal = researchCoverageCsv(coverage);
  assert.match(internal, /eligible_reported_reviews/);
  assert.match(internal, /source_families/);
  assert.match(internal, /facebook_withheld_observations/);
  assert.match(internal, /at least five each/);
  const publicCsv = publicResearchCoverageCsv(coverage);
  assertPublic(publicCsv);
  assert.doesNotMatch(
    publicCsv,
    /eligible_reported_reviews|source_families|at least five each/,
  );
  assert.equal(publicCsv.split("\r\n").length, internal.split("\r\n").length);
});

test("client entry-point dependency graphs cannot import the scorer or private research snapshots", () => {
  const root = resolve("src");
  const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(directory, entry.name))
        : /\.(ts|tsx)$/.test(entry.name)
          ? [join(directory, entry.name)]
          : [],
    );
  const seen = new Set<string>();
  function visit(file: string): void {
    if (seen.has(file)) return;
    seen.add(file);
    assert.doesNotMatch(
      file,
      /\/experience-score\.ts$|\/data\/(?:location-research|regional-markets)\.json$/,
      file,
    );
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const specifiers: string[] = [];
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
      )
        continue;
      if (
        (ts.isExportDeclaration(statement) && statement.isTypeOnly) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.isTypeOnly
      )
        continue;
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        !statement.importClause.name &&
        statement.importClause.namedBindings.elements.every(
          (item) => item.isTypeOnly,
        )
      )
        continue;
      specifiers.push(statement.moduleSpecifier.text);
    }
    function visitDynamicImports(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        specifiers.push(node.arguments[0].text);
      ts.forEachChild(node, visitDynamicImports);
    }
    visitDynamicImports(source);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const base = specifier.startsWith("@/")
        ? join(root, specifier.slice(2))
        : resolve(dirname(file), specifier);
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
      const target = candidates.find((candidate) => {
        try {
          return readFileSync(candidate).length >= 0;
        } catch {
          return false;
        }
      });
      if (target && /\.(ts|tsx|json)$/.test(target)) visit(target);
    }
  }
  for (const file of files(root)) {
    if (/^["']use client["'];/m.test(readFileSync(file, "utf8"))) visit(file);
  }
  assert.ok(seen.size > 0);
});
