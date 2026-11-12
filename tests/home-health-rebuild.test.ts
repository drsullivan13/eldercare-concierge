import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

type Change = {
  file?: string;
  path: (string | number)[];
  value: unknown;
};

// Exercise the rebuild entry point with in-memory source mutations. Intercept every
// output so validation failures can never alter the retained or published evidence.
function rebuild(changes: Change[] = []) {
  const result = spawnSync(
    "python",
    [
      "-B",
      "-c",
      `import contextlib, importlib.util, io, json, sys
from pathlib import Path
changes=json.load(sys.stdin)
spec=importlib.util.spec_from_file_location('rebuild','scripts/prepare-home-health.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_load=module.load
outputs=[]
def load(name):
    value=original_load(name)
    for change in changes:
        if change.get('file','normalized-unit-evidence.json')!=name:
            continue
        target=value
        for key in change['path'][:-1]:
            target=target[key]
        target[change['path'][-1]]=change['value']
    return value
def capture(path,value):
    rendered=(json.dumps(value,indent=2,ensure_ascii=False)+'\\n').encode()
    outputs.append({'name':path.name,'unchanged':rendered==path.read_bytes()})
module.load=load
module.write_json=capture
try:
    with contextlib.redirect_stdout(io.StringIO()):
        module.main()
    print(json.dumps({'ok':True,'outputs':outputs}))
except (ValueError,KeyError) as error:
    print(json.dumps({'ok':False,'error':str(error),'outputs':outputs}))
`,
    ],
    { cwd: process.cwd(), input: JSON.stringify(changes), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    ok: boolean;
    error?: string;
    outputs: { name: string; unchanged: boolean }[];
  };
}

test("home-health rebuild validates the retained evidence without changing its bytes", () => {
  const result = rebuild();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.outputs, [
    { name: "home-health-evidence.json", unchanged: true },
    { name: "source-hashes.json", unchanged: true },
  ]);
});

test("rebuild rejects changed comparator metrics, coverage and reporting metadata before output", () => {
  const base = ["patientExperienceComparators", "massachusetts"];
  const cases: [string, (string | number)[], unknown][] = [
    ["rate", ["measures", 0, "percent", "value"], 999],
    ["raw rate", ["measures", 0, "percent", "rawValue"], "999"],
    ["count", ["completedSurveys", "value"], 999],
    ["response rate", ["responseRate", "value"], 999],
    [
      "count identity",
      ["completedSurveys", "sourceColumn"],
      "Survey response rate",
    ],
    ["units", ["measures", 0, "percent", "unit"], "stars out of 5"],
    ["missing measures", ["measures"], []],
    ["source file", ["sourceFile"], "matched-vxub-6swi.json"],
    ["release date", ["releasedAt"], "2026-01-01"],
    ["period start", ["period", "start"], "2024-04-01"],
    ["period end", ["period", "end"], "2025-03-31"],
    ["period label", ["period", "label"], "A different period"],
  ];
  for (const [label, path, value] of cases) {
    const result = rebuild([{ path: [...base, ...path], value }]);
    assert.equal(result.ok, false, label);
    assert.deepEqual(result.outputs, [], label);
  }
  const wrongState = rebuild([
    { file: "matched-m5jg-jg7i.json", path: [0, "State"], value: "NY" },
  ]);
  assert.equal(wrongState.ok, false);
  assert.match(wrongState.error!, /reporting identity/);
  assert.deepEqual(wrongState.outputs, []);
});

test("rebuild verifies comparator, survey and clinical footnotes and supplemental metrics", () => {
  const paths: (string | number)[][] = [
    ["patientExperienceComparators", "national", "measures", 0, "percent"],
    ["units", 0, "patientExperience", "measures", 0, "percent"],
    ["units", 0, "patientExperience", "measures", 0, "starRating"],
    ["units", 0, "patientExperience", "summaryStarRating"],
    ["units", 0, "qualityOfPatientCare", "starRating"],
    ["units", 0, "qualityOfPatientCare", "components", 0, "rate"],
  ];
  for (const path of paths) {
    for (const [field, value] of [
      ["rawFootnote", "11"],
      ["footnoteCodes", ["11"]],
    ] as const) {
      const result = rebuild([{ path: [...path, field], value }]);
      assert.equal(result.ok, false, path.join("."));
      assert.match(result.error!, /Footnote mismatch/);
      assert.deepEqual(result.outputs, []);
    }
  }
  for (const [field, value] of [
    ["rawGeneralFootnote", "11"],
    ["generalFootnoteCodes", ["11"]],
  ] as const) {
    const result = rebuild([
      { path: ["units", 0, "patientExperience", field], value },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /Footnote mismatch/);
  }
  const supplemental = rebuild([
    {
      path: [
        "units",
        0,
        "qualityOfPatientCare",
        "components",
        6,
        "observedRate",
        "value",
      ],
      value: 999,
    },
  ]);
  assert.equal(supplemental.ok, false);
  assert.match(supplemental.error!, /Metric mismatch/);
  assert.deepEqual(supplemental.outputs, []);
});
