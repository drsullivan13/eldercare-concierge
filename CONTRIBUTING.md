# Working on Harbor

Start with [the architecture map](docs/architecture.md) and [domain terms](GLOSSARY.md). The [documentation index](docs/README.md) links to scoring policy, data provenance and operations.

## Local workflow

Use Node 24 and the committed npm lockfile.

```sh
npm ci
npm run dev
```

Provider research works without secrets. The default workspace stores the plan in the browser; accounts remain disabled. Do not turn on accounts just to test care search.

Before publishing a code change:

```sh
npm run lint
npm run knip
npm test
npm run build
PLAYWRIGHT_START_SERVER=1 npm run test:e2e
```

Stop any server using `.next` before rebuilding it. Playwright uses system Chromium when available; otherwise install its browser with `npx playwright install chromium`. CI runs the same checks on Node 24.

Run focused tests while changing a module, then the complete relevant checks at integration. Tests should exercise behavior through a module's interface: search results, score exclusions, exported plans, request recovery and actual user actions. Avoid tests that merely repeat implementation details.

## Code organization

- Keep search requests, workspace persistence and provider evidence separate. A view should not need to know how local storage or a score calculation works.
- Prefer a small interface that owns a complete job. Do not extract a wrapper solely to shorten a file or introduce a generic framework for one caller.
- Export only declarations used outside their file. Knip checks routes, browser tests, standalone scripts and the Deno worker; its configuration explains the one Deno protocol exception.
- Keep domain types and display constants independent of the large server-side research snapshots. Use type-only imports when a browser module needs only a type.
- Use existing CSS rules and component styles deliberately; avoid stacking contradictory overrides to fix one screen size.
- Keep data provenance. Generated JSON is an output of reviewed inputs, not a place to patch a rating or address directly.

## Data changes

The offline rebuilds are independent commands:

```sh
python scripts/prepare-data.py
python scripts/prepare-inspections.py
python scripts/prepare-home-health.py
python scripts/prepare-location-research.py
```

Review the resulting diff. A formatting or architecture change should not alter these snapshots. Prettier excludes `src/data/` and retained `research/` files so formatting cannot invalidate source hashes. A research update should retain the source, date, exact provider or care unit, and exclusions. The registry seed preserves existing database rows; it is not a synchronization command.

Consumer experience scores, CMS clinical evidence and selected social accounts have different meanings. Keep their labels and calculations separate. Missing evidence stays missing. Do not hide abuse, special-focus or admission warnings when simplifying the interface.

## Engineering skills

The full released Matt Pocock plugin is installed in the current Codex environment: `mattpocock-skills@mattpocock`, version 1.3.2, with 27 engineering and productivity skills. Its experimental and miscellaneous source folders are not part of the released plugin.

To install it in another Codex environment:

```sh
codex plugin marketplace add mattpocock/skills
codex plugin add mattpocock-skills@mattpocock
```

Use `codebase-design` for module design and `code-review` for separate standards and requirement checks. The current cleanup uses commit `c45b6d1` as its review baseline and the user's cleanup request as its scope. Installation does not create issue labels or change the repository's issue workflow. See the [upstream instructions](https://github.com/mattpocock/skills) for optional tracker setup.
