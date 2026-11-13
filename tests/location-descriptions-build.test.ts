import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const official = join(root, "research/north-jersey/descriptions/official");
const builder = join(root, "scripts/prepare-location-descriptions.py");
const research = "research/north-jersey/descriptions";
const privateOptions = {
  skip:
    process.env.LOCATION_DESCRIPTIONS_PRIVATE_SOURCES === "1"
      ? false
      : "Set LOCATION_DESCRIPTIONS_PRIVATE_SOURCES=1 in the local acquisition pipeline",
};
type Entry = {
  providerId: string;
  summary: string;
  scope: string;
  basis: string;
  sources: {
    url: string;
    publisher: string;
    title: string;
    checkedAt: string;
  }[];
  limitations: string[];
};
type Provider = { id: string; category: string; address: string };
type Inputs = {
  providers: Provider[];
  baseline: Record<string, Entry>;
  residential?: Record<string, Entry>;
  offices?: Record<string, Entry>;
};

const source = {
  url: "https://www.nj.gov/example",
  publisher: "New Jersey fixture publisher",
  title: "Exact-location fixture listing",
  checkedAt: "2026-11-13",
};

function entry(
  providerId: string,
  scope: string,
  basis = "official-listing",
): Entry {
  return {
    providerId,
    summary:
      "The official listing identifies this exact provider in Morristown.",
    scope,
    basis,
    sources: [{ ...source }],
    limitations: ["This is a test fixture, not a current availability check."],
  };
}

function fixtures(): Inputs {
  const providers = [
    { id: "cms-315001", category: "nursing-home", address: "1 Main Street" },
    {
      id: "north-jersey-campus-example",
      category: "life-plan",
      address: "1 Main Street",
    },
    {
      id: "north-jersey-hp-hp001",
      category: "home-care",
      address: "2 Main Street",
    },
    {
      id: "north-jersey-hp-hp002",
      category: "home-care",
      address: "P.O. BOX 44",
    },
    { id: "cms-317001", category: "home-health", address: "3 Main Street" },
  ];
  const scopes = [
    "facility",
    "campus",
    "agency-office",
    "service-area",
    "agency-office",
  ];
  return {
    providers,
    baseline: Object.fromEntries(
      providers.map((p, i) => [p.id, entry(p.id, scopes[i])]),
    ),
  };
}

function runBuild(inputs: Inputs) {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `import importlib.util, json, sys
spec=importlib.util.spec_from_file_location("descriptions",sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data=json.load(sys.stdin)
providers={p["id"]:p for p in data["providers"]}
try:
    output=module.build(providers,data["baseline"],data.get("residential"),data.get("offices"))
    print(json.dumps({"ok":True,"output":output,"rendered":module.render(output)}))
except (ValueError,KeyError,TypeError) as error:
    print(json.dumps({"ok":False,"error":str(error)}))
`,
      builder,
    ],
    { cwd: root, input: JSON.stringify(inputs), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    ok: boolean;
    error?: string;
    output: {
      schemaVersion: number;
      marketId: string;
      checkedAt: string;
      locations: Record<string, Entry>;
    };
    rendered: string;
  };
}

function withPublicCheckout(check: (checkout: string) => void) {
  const checkout = mkdtempSync(join(tmpdir(), "harbor-public-descriptions-"));
  try {
    for (const file of [
      "scripts/prepare-location-descriptions.py",
      "scripts/validate-location-descriptions-public.py",
      "src/data/regional-markets.json",
      "src/data/location-descriptions.json",
      ...[
        "public-validation.json",
        "official/baseline.json",
        "official/coverage.json",
        "official/capture.json",
        "provider-residential.json",
        "provider-offices.json",
      ].map((file) => `${research}/${file}`),
    ]) {
      const destination = join(checkout, file);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(root, file), destination);
    }
    check(checkout);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

function checkPublic(checkout: string, ...args: string[]) {
  return spawnSync(
    "python3",
    [
      "-B",
      join(checkout, "scripts/validate-location-descriptions-public.py"),
      "--root",
      checkout,
      ...args,
    ],
    {
      cwd: checkout,
      encoding: "utf8",
    },
  );
}

function mutateJson<T>(
  checkout: string,
  file: string,
  mutate: (value: T) => void,
) {
  const path = join(checkout, file);
  const value: T = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
}

test("the public audit validates the accepted normalized source layers", () => {
  const result = checkPublic(root);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const snapshot = JSON.parse(
    readFileSync(join(root, "src/data/location-descriptions.json"), "utf8"),
  );
  assert.equal(report.described, Object.keys(snapshot.locations).length);
  assert.equal(report.checkedAt, snapshot.checkedAt);
});

test("a raw-free checkout builds the shipped JSON through the normal builder CLI", () => {
  withPublicCheckout((checkout) => {
    for (const privatePath of [
      "official/captures",
      "official/cms-alternate-receipt.json",
      "offices/receipts",
      "residential/receipts",
      "offices/collect.py",
    ])
      assert.equal(existsSync(join(checkout, research, privatePath)), false);
    const baseline = join(checkout, "audited-official.json");
    const validation = checkPublic(checkout, "--baseline-output", baseline);
    assert.equal(validation.status, 0, validation.stderr);
    const output = join(checkout, "rebuilt.json");
    const result = spawnSync(
      "python3",
      [
        "-B",
        join(checkout, "scripts/prepare-location-descriptions.py"),
        "--baseline",
        baseline,
        "--output",
        output,
      ],
      { cwd: checkout, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(output, "utf8"),
      readFileSync(join(root, "src/data/location-descriptions.json"), "utf8"),
    );
  });
});

test("public validation rejects inventory identity drift without original receipts", () => {
  for (const field of [
    "id",
    "name",
    "address",
    "city",
    "zip",
    "category",
    "locationKind",
  ]) {
    withPublicCheckout((checkout) => {
      mutateJson<{ id: string; providers: Record<string, string>[] }[]>(
        checkout,
        "src/data/regional-markets.json",
        (markets) => {
          markets.find((market) => market.id === "north-jersey")!.providers[0][
            field
          ] = "changed";
        },
      );
      const result = checkPublic(checkout);
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, /identity differs/);
    });
  }
});

test("public validation rejects unaudited summary, provenance, date and membership changes in every layer", () => {
  const mutations: {
    name: string;
    change: (entries: Record<string, Entry>) => void;
  }[] = [
    {
      name: "summary",
      change: (entries) => {
        Object.values(entries)[0].summary += " An unreviewed claim.";
      },
    },
    {
      name: "publisher",
      change: (entries) => {
        Object.values(entries)[0].sources[0].publisher = "Another publisher";
      },
    },
    {
      name: "URL",
      change: (entries) => {
        Object.values(entries)[0].sources[0].url =
          "https://example.org/another-location";
      },
    },
    {
      name: "title",
      change: (entries) => {
        Object.values(entries)[0].sources[0].title = "Another location";
      },
    },
    {
      name: "past date",
      change: (entries) => {
        Object.values(entries)[0].sources[0].checkedAt = "2020-01-01";
      },
    },
    {
      name: "invalid date",
      change: (entries) => {
        Object.values(entries)[0].sources[0].checkedAt = "2026-02-30";
      },
    },
    {
      name: "wrong ID",
      change: (entries) => {
        Object.values(entries)[0].providerId = "cms-315999";
      },
    },
    {
      name: "wrong scope",
      change: (entries) => {
        Object.values(entries)[0].scope = "unknown";
      },
    },
    {
      name: "removed entry",
      change: (entries) => {
        delete entries[Object.keys(entries)[0]];
      },
    },
  ];
  for (const file of [
    "official/baseline.json",
    "provider-residential.json",
    "provider-offices.json",
  ]) {
    for (const mutation of mutations) {
      withPublicCheckout((checkout) => {
        mutateJson(checkout, `${research}/${file}`, mutation.change);
        const rejectedBaseline = join(checkout, "rejected-baseline.json");
        const result = checkPublic(
          checkout,
          "--baseline-output",
          rejectedBaseline,
        );
        assert.notEqual(result.status, 0, `${file}: ${mutation.name}`);
        assert.match(result.stderr, /ValueError/, `${file}: ${mutation.name}`);
        assert.equal(existsSync(rejectedBaseline), false);
      });
    }
  }
});

test("public validation detects changed CMS inputs, audit coverage, and published output", () => {
  for (const file of ["official/coverage.json", "official/capture.json"]) {
    withPublicCheckout((checkout) => {
      mutateJson<Record<string, unknown>>(
        checkout,
        `${research}/${file}`,
        (value) => {
          value.unreviewed = true;
        },
      );
      const result = checkPublic(checkout);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /normalized input differs/);
    });
  }
  withPublicCheckout((checkout) => {
    mutateJson<{ cmsSupplement: Record<string, Entry> }>(
      checkout,
      `${research}/public-validation.json`,
      (value) => {
        Object.values(value.cmsSupplement)[0].summary += " An unaudited fact.";
      },
    );
    const result = checkPublic(checkout);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CMS normalized supplement differs/);
  });
  withPublicCheckout((checkout) => {
    mutateJson<{ locations: Record<string, Entry> }>(
      checkout,
      "src/data/location-descriptions.json",
      (value) => {
        Object.values(value.locations)[0].summary += " An output-only edit.";
      },
    );
    const result = checkPublic(checkout);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Public descriptions differ/);
  });
});

test("public validation rejects duplicate JSON keys and missing normalized inputs", () => {
  withPublicCheckout((checkout) => {
    const file = join(checkout, research, "provider-offices.json");
    const entries: Record<string, Entry> = JSON.parse(
      readFileSync(file, "utf8"),
    );
    const [id, value] = Object.entries(entries)[0];
    writeFileSync(
      file,
      `{${JSON.stringify(id)}:${JSON.stringify(value)},${readFileSync(file, "utf8").trim().slice(1)}`,
    );
    const result = checkPublic(checkout);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Duplicate JSON key/);
  });
  withPublicCheckout((checkout) => {
    rmSync(join(checkout, research, "provider-offices.json"));
    const result = checkPublic(checkout);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FileNotFoundError/);
  });
});

test("every active North Jersey ID has an honest official collection disposition", () => {
  const markets = JSON.parse(
    readFileSync(join(root, "src/data/regional-markets.json"), "utf8"),
  );
  const providers = markets.find(
    (m: { id: string }) => m.id === "north-jersey",
  ).providers;
  const baseline = JSON.parse(
    readFileSync(join(official, "baseline.json"), "utf8"),
  );
  const coverage = JSON.parse(
    readFileSync(join(official, "coverage.json"), "utf8"),
  );
  assert.equal(providers.length, 974);
  assert.deepEqual(
    coverage.locations.map((p: { providerId: string }) => p.providerId).sort(),
    providers.map((p: Provider) => p.id).sort(),
  );
  assert.deepEqual(
    coverage.locations
      .filter((p: { status: string }) => p.status === "described")
      .map((p: { providerId: string }) => p.providerId)
      .sort(),
    Object.keys(baseline).sort(),
  );
  assert.equal(coverage.describedCount, Object.keys(baseline).length);
  for (const row of coverage.locations)
    assert.ok(
      ["described", "fetch-failed", "identity-conflict"].includes(row.status),
    );
  const result = spawnSync(
    "python3",
    ["-B", builder, "--check", "--baseline-only"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).described,
    Object.keys(baseline).length,
  );
});

test(
  "the shipped release replays from original official receipts and reviewed provider decisions",
  privateOptions,
  () => {
    const code = `import importlib.util,json,sys,contextlib,io
from pathlib import Path
root=Path(sys.argv[1])
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
releases=module("releases",root/"scripts/prepare-location-descriptions.py")
collector=module("provider_pages",root/"research/north-jersey/descriptions/offices/collect.py")
outputs={}
def capture(path,value):
    outputs[str(path.relative_to(root))]=value==json.loads(path.read_text())
collector.write=capture
with contextlib.redirect_stdout(io.StringIO()):
    collector.build()
providers=releases.active_providers(root/"src/data/regional-markets.json")
research=root/"research/north-jersey/descriptions"
supplement,matches=releases.cms_supplement(providers)
audit=releases.load(research/"public-validation.json")
assert supplement==audit["cmsSupplement"]
assert {
    pid:{"receipt":match["receipt"],"markdownSha256":match["sha256"],"source":supplement[pid]["sources"][0]}
    for pid,match in matches.items()
}==audit["cmsProvenance"]
baseline=releases.load(research/"official/baseline.json")
assert not set(supplement)&set(baseline)
result=releases.build(providers,{**baseline,**supplement},releases.load(research/"provider-residential.json"),releases.load(research/"provider-offices.json"))
assert releases.render(result)==(root/"src/data/location-descriptions.json").read_text()
assert all(outputs.values()),outputs
assert set(matches)==set(supplement)
print(json.dumps({"providerOutputs":len(outputs),"cmsMatches":len(matches)}))
`;
    const result = spawnSync("python3", ["-B", "-c", code, root], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const replay = JSON.parse(result.stdout);
    assert.equal(replay.providerOutputs, 3);
    assert.equal(replay.cmsMatches, 32);
    const residential = spawnSync(
      process.execPath,
      [
        join(
          root,
          "research/north-jersey/descriptions/residential/assemble.mjs",
        ),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(residential.status, 0, residential.stderr);
  },
);

test(
  "provider releases reject inventory drift, missing extracts and unsuccessful receipts",
  privateOptions,
  () => {
    for (const mutation of ["identity", "extract", "receipt"]) {
      const code = `import importlib.util,sys,contextlib,io
from pathlib import Path
root=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("pages",root/"research/north-jersey/descriptions/offices/collect.py")
pages=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)
read=pages.read
def altered(path):
    value=read(path)
    if path.name=="decisions.json":
        decision=value["cms-317008"]
        if sys.argv[2]=="identity": decision["expectedIdentity"]["address"]="WRONG OFFICE"
        if sys.argv[2]=="extract": decision["extracts"][0]["text"]="A fact never retrieved"
    if path.name=="hh-valley.json" and sys.argv[2]=="receipt": value["metadata"]["statusCode"]=403
    return value
pages.read=altered
pages.write=lambda *args:None
try:
    with contextlib.redirect_stdout(io.StringIO()): pages.build()
except AssertionError:
    print("rejected")
else:
    raise RuntimeError("Invalid source release accepted")
`;
      const result = spawnSync("python3", ["-B", "-c", code, root, mutation], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "rejected");
    }
  },
);

test(
  "official baseline replays byte-for-byte from hashed fetched source files",
  privateOptions,
  () => {
    const code = `import importlib.util,json,sys,contextlib,io
from pathlib import Path
here=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("collector",here/"collect.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
outputs={}
def capture(path,value):
    rendered=json.dumps(value,indent=2,ensure_ascii=False,sort_keys=True)+"\\n"
    outputs[path.name]=rendered==path.read_text()
module.write_json=capture
with contextlib.redirect_stdout(io.StringIO()):
    module.replay()
print(json.dumps(outputs))
`;
    const result = spawnSync("python3", ["-B", "-c", code, official], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      "baseline.json": true,
      "matched-rows.json": true,
      "coverage.json": true,
    });
  },
);

test(
  "private official replay rejects changed capture hashes and lengths without editing receipts",
  privateOptions,
  () => {
    const code = `import importlib.util,json,sys
from pathlib import Path
here=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("collector",here/"collect.py")
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
for field in ("sha256","bytes"):
    manifest=json.loads((here/"capture.json").read_text())
    source=next(source for source in manifest["sources"].values() if source["status"]=="fetched")
    source[field]="0"*64 if field=="sha256" else source[field]+1
    try:
        collector.load_capture(manifest)
    except ValueError as error:
        assert "hash or byte length differs" in str(error)
    else:
        raise RuntimeError("Changed capture accepted")
print("rejected")
`;
    const result = spawnSync("python3", ["-B", "-c", code, official], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "rejected");
  },
);

test("exact object keys cannot redirect descriptions or introduce orphan IDs", () => {
  const wrongKey = fixtures();
  wrongKey.baseline["cms-315001"].providerId = "cms-315002";
  assert.match(runBuild(wrongKey).error!, /exact object key/);
  const orphan = fixtures();
  orphan.baseline["cms-315002"] = entry("cms-315002", "facility");
  assert.match(runBuild(orphan).error!, /orphan provider ID/);
});

test("campuses and nursing units remain distinct at a shared address", () => {
  for (const [id, scope] of [
    ["cms-315001", "campus"],
    ["north-jersey-campus-example", "facility"],
  ]) {
    const inputs = fixtures();
    inputs.baseline[id].scope = scope;
    assert.match(runBuild(inputs).error!, /scope/);
  }
  const wrongCcn = fixtures();
  wrongCcn.baseline["cms-315001"].summary =
    "CMS identifies this nursing unit under CCN 315002.";
  assert.match(runBuild(wrongCcn).error!, /another unit or agency CCN/);
  const capacity = fixtures();
  capacity.baseline["north-jersey-campus-example"].summary =
    "The retirement campus has 100 certified beds.";
  assert.match(runBuild(capacity).error!, /capacity or CCN/);
  const cmsCampus = fixtures();
  cmsCampus.baseline["north-jersey-campus-example"].sources[0].url =
    "https://data.cms.gov/provider-data/dataset/4pq5-n9py";
  assert.match(runBuild(cmsCampus).error!, /CMS care-unit evidence/);
});

test("registration offices are not skilled home health or residential facilities", () => {
  for (const claim of [
    "This provider is a Medicare-certified home-health agency in Morristown.",
    "This provider is a skilled home health agency in Morristown.",
    "This provider is a residential facility in Morristown.",
    "This provider offers guaranteed available caregivers in Morristown.",
  ]) {
    const inputs = fixtures();
    inputs.baseline["north-jersey-hp-hp001"].summary = claim;
    assert.match(
      runBuild(inputs).error!,
      /registration is not clinical certification/,
    );
  }
  const inputs = fixtures();
  inputs.baseline["cms-317001"].scope = "facility";
  assert.match(runBuild(inputs).error!, /scope/);
});

test("PO-box-only registrations use service-area scope without promoting ZIP precision to coverage", () => {
  const inputs = fixtures();
  inputs.baseline["north-jersey-hp-hp002"].scope = "agency-office";
  assert.match(runBuild(inputs).error!, /scope/);
  const zipOffice = fixtures();
  Object.assign(zipOffice.providers[2], { locationKind: "zip" });
  assert.equal(
    runBuild(zipOffice).output.locations["north-jersey-hp-hp001"].scope,
    "agency-office",
  );
});

test("missing descriptions stay absent instead of inventing fallback text", () => {
  const inputs = fixtures();
  delete inputs.baseline["cms-315001"];
  const result = runBuild(inputs);
  assert.equal(result.ok, true);
  assert.equal("cms-315001" in result.output.locations, false);
  assert.equal(
    Object.keys(result.output.locations).length,
    inputs.providers.length - 1,
  );
});

test("provider overrides replace only the exact ID and retain their source attribution", () => {
  const inputs = fixtures();
  inputs.residential = {
    "cms-315001": entry("cms-315001", "facility", "provider"),
  };
  inputs.offices = {
    "cms-317001": entry("cms-317001", "agency-office", "provider"),
  };
  inputs.offices["cms-317001"].summary =
    "The agency's own page identifies its Morristown office.";
  const result = runBuild(inputs);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.output.locations["cms-315001"].basis, "provider");
  assert.equal(
    result.output.locations["cms-317001"].summary,
    inputs.offices["cms-317001"].summary,
  );
  assert.deepEqual(
    result.output.locations["north-jersey-campus-example"],
    inputs.baseline["north-jersey-campus-example"],
  );
  inputs.offices["cms-315001"] = entry("cms-315001", "facility", "provider");
  assert.match(runBuild(inputs).error!, /residential entry in office override/);
});

test("empty, malformed, credentialed, private, and undated sources fail validation", () => {
  for (const url of [
    "http://www.nj.gov/example",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://user:password@www.nj.gov/a",
    "https://www.nj.gov/a?api_key=secret",
  ]) {
    const inputs = fixtures();
    inputs.baseline["cms-315001"].sources[0].url = url;
    assert.equal(runBuild(inputs).ok, false, url);
  }
  for (const checkedAt of [
    "2026-02-30",
    "2026-11",
    "2026-11-13T00:00:00Z",
    "2999-01-01",
  ]) {
    const inputs = fixtures();
    inputs.baseline["cms-315001"].sources[0].checkedAt = checkedAt;
    assert.equal(runBuild(inputs).ok, false, checkedAt);
  }
  const inputs = fixtures();
  inputs.baseline["cms-315001"].sources = [];
  assert.match(runBuild(inputs).error!, /sources cannot be empty/);
});

test("replay is deterministic and never stamps a new check date", () => {
  const inputs = fixtures();
  const first = runBuild(inputs);
  inputs.providers.reverse();
  inputs.baseline = Object.fromEntries(
    Object.entries(inputs.baseline).reverse(),
  );
  const second = runBuild(inputs);
  assert.equal(first.rendered, second.rendered);
  assert.equal(first.output.checkedAt, source.checkedAt);
  assert.equal(first.output.schemaVersion, 1);
  assert.equal(first.output.marketId, "north-jersey");
});
