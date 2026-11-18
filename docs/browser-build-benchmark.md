# Browser shard build benchmark

Harbor keeps a separate production build in each browser shard. On November 18, 2026, sharing one build reduced compilation time but added a sequential job and did not improve the measured CI run.

| Hosted measurement | Build in each shard | Share one build |
| --- | ---: | ---: |
| Workflow elapsed | 465 s | 530 s |
| Sum of runner job seconds | 988 s | 1,425 s |
| Production compilation, sum | 52 s | 23 s |
| Browser jobs plus build job, excluding actual browser-test steps | 109 s | 124 s |
| Browser test steps, two shards | 373 s / 284 s | 361 s / 369 s |
| Unit/database job | 156 s | 506 s |

Both runs passed. The [baseline run](https://github.com/drsullivan13/eldercare-concierge/actions/runs/44334518254) tested the report history change. The [experiment](https://github.com/drsullivan13/eldercare-concierge/actions/runs/44338204502) used the merged application with the workflow change only. It built the application once, archived the Next.js output excluding its build cache, transferred it through GitHub Artifacts, then ran the normal desktop and mobile suites. No tests or retries changed.

The separate build job took 41 seconds, including 23 seconds of compilation. Compression and upload took three seconds combined. Download and extraction took one to two seconds per shard. A single pair cannot establish median or p95 behavior, and variation in the unrelated unit/database lane explains much of the total runner difference. The directly comparable setup and build work increased by 15 runner seconds after removing browser-test execution time. Revisit if production compilation becomes a larger share of the critical path.
