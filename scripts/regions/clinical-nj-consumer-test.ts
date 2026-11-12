import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { getInspectionEvidence } from "../../src/lib/inspections";
import { getHomeHealthEvidence } from "../../src/lib/home-health";
import { createMarketRegistry, markets } from "../../src/lib/markets";
import type { InspectionHistorySnapshot } from "../../src/lib/inspections";
import type { HomeHealthEvidenceSnapshot } from "../../src/lib/home-health";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clinical = path.join(root, "research/north-jersey/clinical");

function read<T>(filename: string): T {
  return JSON.parse(readFileSync(path.join(clinical, filename), "utf8"));
}

const inspection = read<InspectionHistorySnapshot>("inspection-history.json");
const hh = read<HomeHealthEvidenceSnapshot>("home-health-evidence.json");
const market = markets.find((m) => m.id === "north-jersey");
assert.ok(market);
const registry = createMarketRegistry([{ ...market, inspectionHistory: inspection, homeHealthEvidence: hh }]);
assert.equal(Object.keys(inspection.facilities).length, 139);
assert.equal(hh.agencies.length, 18);

for (const ccn of Object.keys(inspection.facilities)) {
  const evidence = getInspectionEvidence(ccn, 25, registry);
  const original = inspection.facilities[ccn];
  assert.equal(evidence.ccn, ccn);
  assert.equal(evidence.healthCitations.total, original.healthCitations?.total);
  assert.equal(evidence.healthCitations.returned, original.healthCitations?.records.length);
  assert.equal(evidence.penalties.total, original.penalties?.total);
  assert.equal(evidence.penalties.fineCount, original.penalties?.fineCount);
  assert.equal(evidence.penalties.paymentDenialCount, original.penalties?.paymentDenialCount);
  const bounded = getInspectionEvidence(ccn, 1, registry);
  assert.ok(bounded.healthCitations.returned <= 1);
  assert.equal(
    bounded.healthCitations.hasMore,
    (original.healthCitations?.total ?? 0) > bounded.healthCitations.returned,
  );
}

for (const agency of hh.agencies) {
  const response = getHomeHealthEvidence(agency.organizationId, registry);
  assert.equal(response.agencies.length, 1);
  assert.equal(response.agencies[0].ccn, agency.ccn);
  assert.equal(response.patientExperienceComparators.state?.code, "NJ");
  assert.equal(response.patientExperienceComparators.massachusetts, undefined);
  assert.equal(response.patientExperienceComparators.ma, undefined);
}

for (const ccn of ["315001", "999999"]) {
  assert.throws(() => getInspectionEvidence(ccn, 5, registry));
}
for (const limit of [0, 26, "1.5"]) {
  assert.throws(() => getInspectionEvidence("315005", limit, registry));
}
for (const providerId of ["cms-397736", "cms-317023", "vna-care", "../317002"]) {
  assert.throws(() => getHomeHealthEvidence(providerId, registry));
}

const hhLookup = getHomeHealthEvidence("cms-317002", registry);
const timely = hhLookup.agencies[0].qualityOfPatientCare.components.find(
  (component) => component.id === "timely-care",
);
assert.equal(timely?.rate.value, 99.75);
assert.equal(timely?.publishedNumerator?.value, 3186);
assert.equal(timely?.publishedDenominator?.value, 3194);
assert.equal(hhLookup.agencies[0].patientExperience.completedSurveys.value, 330);
assert.equal(hhLookup.agencies[0].patientExperience.period.end, "2026-03-31");
const nursingLookup = getInspectionEvidence("315005", 1, registry);
assert.equal(nursingLookup.healthCitations.total, 32);

const virtualPath = path.join(clinical, "consumer-compatibility.virtual.ts");
const virtualSource = [
  'import type { InspectionHistorySnapshot } from "../../../src/lib/inspections";',
  'import type { HomeHealthEvidenceSnapshot } from "../../../src/lib/home-health";',
  `const inspections = <T extends InspectionHistorySnapshot>(value: T) => value; const inspection = inspections(${JSON.stringify(inspection)});`,
  `const agencies = <T extends HomeHealthEvidenceSnapshot>(value: T) => value; const homeHealth = agencies(${JSON.stringify(hh)});`,
  "void inspection; void homeHealth;",
].join("\n");
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const options = { ...parsed.options, noEmit: true, incremental: false };
const host = ts.createCompilerHost(options);
const originalRead = host.readFile.bind(host);
const originalExists = host.fileExists.bind(host);
host.readFile = (filename) => filename === virtualPath ? virtualSource : originalRead(filename);
host.fileExists = (filename) => filename === virtualPath || originalExists(filename);
const program = ts.createProgram([virtualPath], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnostics(diagnostics.slice(0, 8), {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }),
);

const report = {
  status: "passed",
  command: "TSX_DISABLE_CACHE=1 node --import tsx scripts/regions/clinical-nj-consumer-test.ts",
  nursingLookups: 139,
  homeHealthLookups: 18,
  staticTypeDiagnostics: diagnostics.length,
  staticTypeCheck: "Actual JSON literals satisfy exported snapshot types through an in-memory TypeScript program. No emitted files.",
  registryNote: "The real APIs use the published NJ provider identities and the generated clinical fragments.",
  concreteLookup: {
    nursing: nursingLookup,
    homeHealth: {
      providerId: hhLookup.providerId,
      ccn: hhLookup.agencies[0].ccn,
      timelyCare: timely,
      completedSurveys: hhLookup.agencies[0].patientExperience.completedSurveys,
      surveyPeriod: hhLookup.agencies[0].patientExperience.period,
      stateComparator: hhLookup.patientExperienceComparators.state,
    },
  },
};
writeFileSync(path.join(clinical, "consumer-test-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  status: report.status,
  nursingLookups: report.nursingLookups,
  homeHealthLookups: report.homeHealthLookups,
  staticTypeDiagnostics: report.staticTypeDiagnostics,
  nursingExampleTotal: nursingLookup.healthCitations.total,
  homeHealthExampleTimelyCare: timely?.rate.value,
}));
