#!/usr/bin/env -S node --import tsx
import { markets } from "../src/lib/markets";
import { officeEvidenceReview } from "../src/lib/public-office-evidence";
const args = process.argv.slice(2);
if (
  args.some((arg) => !arg.startsWith("--as-of=") && !arg.startsWith("--limit="))
)
  throw new Error(
    "Usage: node --import tsx scripts/office-evidence-review.ts [--as-of=YYYY-MM-DD] [--limit=25]",
  );
const at =
  args.find((arg) => arg.startsWith("--as-of="))?.slice(8) ??
  new Date().toISOString().slice(0, 10);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(at) ||
  !Number.isFinite(Date.parse(at)) ||
  new Date(at).toISOString().slice(0, 10) !== at
)
  throw new Error("Supply a valid --as-of date.");
const limit = Number(
  args.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 25,
);
if (!Number.isInteger(limit) || limit < 0 || limit > 100)
  throw new Error("Limit must be an integer from 0 to 100.");
console.log(
  JSON.stringify(
    officeEvidenceReview(
      markets.flatMap((market) => market.providers),
      Object.assign(
        {},
        ...markets.map((market) => market.locationResearch ?? {}),
      ),
      at,
      limit,
    ),
    null,
    2,
  ),
);
