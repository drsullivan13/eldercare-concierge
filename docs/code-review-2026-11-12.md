# Code review · November 12, 2026

Harbor's architecture cleanup reduces the work needed to follow the family workspace while preserving search rules, evidence meaning and the separation between private collection and public research. The implementation review compares baseline `c45b6d1` with `6b5d20e`; the wording correction below was applied afterward.

## What changed

- The dashboard decreased from **1,771 to 435 lines**. Search state, saved-provider loading, screens, dialogs and plan export now live in cohesive modules with smaller interfaces. The dashboard coordinates navigation and shared actions.
- Provider cards and details present research more compactly. Supporting methodology uses disclosures; material care warnings remain visible. Card styles have their own file. A final audit removed 58 additional unused dashboard selectors across 22 class families and restored 13px mobile action text.
- The existing deep search, scoring, workspace-validation and research-import modules retain their rules. Public evidence still comes from reviewed snapshots; private collection does not publish automatically.
- The [architecture map](architecture.md), [contributor guide](../CONTRIBUTING.md), [glossary](../GLOSSARY.md) and documentation index provide an entry point for future work. Operational descriptions were updated to distinguish implemented private monitoring from manual publication.
- Knip now checks the application, tests, standalone scripts and Deno entry point. It reports **zero unused dependencies**; this is an audit result, not a claim that dependencies were removed.

The official released Matt Pocock plugin, `mattpocock-skills@mattpocock` **v1.3.2**, is installed in the working environment with **27 released skills**. The cleanup used its module-design vocabulary and separate standards and requirements reviews. Installation details are in the contributor guide.

## Findings and resolutions

| Finding                                                                                                                                                       | Resolution                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan export used asynchronously loaded provider records. Exporting during loading or after a failed lookup could silently omit saved options and their notes. | Export now starts from the saved workspace IDs, retains notes and task associations, and includes an explicit fallback when catalog details are unavailable. Loading and lookup failure are distinct from an empty shortlist. Focused tests cover absent and partially loaded records. |
| Home-health rebuild validation did not cover all retained comparator metadata, footnotes and supplemental clinical metrics.                                   | The rebuild now checks those values against retained CMS inputs, including reporting identity, units and periods. Mutation tests verify rejection before output; the retained snapshot and source-hash manifest remain byte-identical.                                                 |
| The standards review found one wording violation: a compact card label shortened “reviews reported” to “reviews.”                                             | “Reviews reported” was restored so the count is not presented as independently verified people or experiences.                                                                                                                                                                         |

The separate requirements review reported **zero findings**. No review result establishes current provider suitability or the completeness of upstream research.

## Validation at this review checkpoint

- ESLint: passed.
- Knip: passed, including zero unused dependencies.
- Production build: passed.
- Node test suite: **115 tests passed**, covering domain behavior, imports, rebuilds and actual local PostgreSQL rules.
- Desktop/mobile browser acceptance: **44 scenarios passed**, including visible care alerts and plan export during a failed provider lookup. Four new cases passed after correcting test selectors and waiting for the workspace to initialize before mobile navigation.
- Automated accessibility: **zero violations across 12 pages and dialogs**. Root reviewed desktop/mobile screenshots and corrected duplicated address text in provider details.
- Hosted acceptance passed on application commit `b3b01c8`: real search and evidence APIs, Facebook expansion, shortlist persistence, downloaded plan, account redirects and mobile layout. No uncaught browser errors occurred. The deployment scan found no error/fatal logs in its ten-minute window. The subsequent CSS and singular-label corrections are recorded in the verification record.

See [the verification record](verification.md) for subsequent acceptance results. Local PostgreSQL tests do not prove hosted authentication, email delivery or independent-session contention; accounts remain deferred.

## Limited follow-up candidates

1. **Evidence request lifecycle:** three evidence views repeat cancellation, identity checks and retry state. Consider a shared module only if its interface preserves their different loading behavior, especially inspection pagination retaining prior results.
2. **Collector request orchestration:** collector functions and SQL are tested separately. When worker behavior changes, expose its request handling through a testable seam to exercise ticket consumption, budgets, claims and completion together.
3. **Offline rebuild checks:** consider one check command over the existing source-specific scripts to detect generated-output drift. Keep editorial publication and private registry updates explicit.

These are candidates, not required additions to this cleanup. No generic request framework, automatic publication path or replacement for the tested domain modules is proposed.
