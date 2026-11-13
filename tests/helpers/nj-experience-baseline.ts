import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Inventory = {
  asOfDate: string;
  runtimeProviders: {
    providerId: string;
    experience: { value: number | null };
    reviewAggregates: { sourceId: string }[];
    sources: { id: string }[];
  }[];
};

type ProviderFingerprint = {
  experience?: string;
  aggregates?: Record<string, string>;
  sources?: Record<string, string>;
};

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function fingerprint(value: unknown): string {
  return sha256(
    JSON.stringify(value, (_, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : item,
    ),
  );
}

export function fingerprintBaseline(raw: string) {
  const inventory = JSON.parse(raw) as Inventory;
  const providers: Record<string, ProviderFingerprint> = {};
  for (const provider of inventory.runtimeProviders) {
    assert.ok(!Object.hasOwn(providers, provider.providerId));
    const entry: ProviderFingerprint = {};
    if (provider.experience.value !== null) {
      entry.experience = fingerprint(provider.experience);
    }
    if (provider.reviewAggregates.length) {
      entry.aggregates = Object.fromEntries(
        provider.reviewAggregates.map((row) => [
          row.sourceId,
          fingerprint(row),
        ]),
      );
      assert.equal(
        Object.keys(entry.aggregates).length,
        provider.reviewAggregates.length,
      );
    }
    if (provider.sources.length) {
      entry.sources = Object.fromEntries(
        provider.sources.map((source) => [source.id, fingerprint(source)]),
      );
      assert.equal(Object.keys(entry.sources).length, provider.sources.length);
    }
    providers[provider.providerId] = entry;
  }
  return {
    schemaVersion: 1,
    asOfDate: inventory.asOfDate,
    inventorySha256: sha256(raw),
    providers,
  };
}

export function readBaselineFingerprint(path: string, expectedSha256: string) {
  const raw = readFileSync(path);
  assert.equal(
    sha256(raw),
    expectedSha256,
    "Public baseline fingerprint changed.",
  );
  return JSON.parse(raw.toString("utf8")) as ReturnType<
    typeof fingerprintBaseline
  >;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv[2],
    "Usage: tsx tests/helpers/nj-experience-baseline.ts /absolute/local/baseline.json",
  );
  process.stdout.write(
    `${JSON.stringify(fingerprintBaseline(readFileSync(resolve(process.argv[2]), "utf8")), null, 2)}\n`,
  );
}
