<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working in Harbor

Read `CONTRIBUTING.md` for the code organization and check commands, `docs/architecture.md` for the application/data flow, and `GLOSSARY.md` for domain terms. Keep evidence meaning and source provenance intact when simplifying the UI. The full released Matt Pocock plugin is installed in this environment; its installation and review conventions are documented in the contributor guide.

## Coordinate coding work through local Droid agents

The coordinating agent delegates every coding task, including small fixes, to local Factory Droid agents when available. An assigned Droid implements its bounded task directly. The coordinator manages further delegation. Start each delegated task with `/poteto-mode`. The coordinating agent owns the result: inspect the code, define acceptance criteria, give each agent a bounded scope, and review the combined changes. Run independent tasks in parallel with separate file ownership. Assign a follow-up implementation or independent review when gaps remain.

Use Herdr sibling panes when already in Herdr. Otherwise run `droid exec --auto medium --cwd "$PWD" "/poteto-mode <task>"` from this checkout. Preserve unrelated edits. Verify behavior through the normal application entry points before reporting completion. If Droid is unavailable, record the limitation and continue locally.
