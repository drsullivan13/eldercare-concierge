import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Next.js and Playwright plugins discover routes, proxy, config, and E2E tests.
  // These additional entrypoints run independently of the web application.
  entry: [
    "tests/*.test.ts",
    "scripts/capture-preview.mjs",
    "scripts/check-accessibility.mjs",
    "scripts/check-hosted.mjs",
    "scripts/check-location-research.mjs",
    "scripts/import-research.ts",
    "supabase/functions/research-collector/index.ts",
  ],
  project: [
    "*.{ts,mjs}",
    "src/**/*.{ts,tsx}",
    "tests/**/*.{ts,tsx}",
    "scripts/**/*.{ts,mjs}",
    "supabase/functions/**/*.ts",
  ],
  // Knip reads Deno's `npm:@supabase/supabase-js@2.119.0` protocol as an
  // unlisted package named `npm`. Deno resolves that import through deno.lock;
  // the actual @supabase/supabase-js dependency remains audited normally.
  ignoreDependencies: ["npm"],
};

export default config;
