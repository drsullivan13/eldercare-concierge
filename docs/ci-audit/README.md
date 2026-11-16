# Harbor CI audit, November 16, 2026

Fetched 150 runs using gh. 153 completed jobs, 0 running jobs. Window starts 2026-11-12T10:51:16Z and ends with the run created 2026-11-16T13:21:15Z.

| Population | Jobs | Queue p50 / p95 | Setup p50 / p95 | Task steps p50 / p95 | Overhead p50 / p95 |
| ---------- | ---: | --------------: | --------------: | -------------------: | -----------------: |
| All        |  153 |         2s / 2s |       30s / 62s |          130s / 615s |            3s / 5s |
| Successful |   62 |         2s / 3s |       39s / 62s |          155s / 541s |            3s / 5s |
| Failed     |   90 |         2s / 2s |       24s / 59s |          117s / 615s |            3s / 6s |
| PR jobs    |   10 |         2s / 2s |       33s / 77s |          148s / 817s |            3s / 7s |

Queue is measured from job creation to runner start; it is a proxy for machine wait. An upstream job may have delayed job creation. Setup includes runner initialization, checkout, Node setup/cache restore, package installation and browser provisioning. Execution is the rest of runner time. The CSV also separates actual task steps from teardown, artifact handling and gaps. Every completed row reconciles exactly to the timestamps. Percentiles use nearest rank. Workflow elapsed uses run creation and last update, so parallel job times are never added to estimate PR feedback.

## Timing by job

Seconds at p50 / p95. Each row in the job CSV reconciles to GitHub timestamps. The overhead column includes artifact handling, teardown and time between reported steps.

| Job                 | Count | Queue |   Setup | Task steps | Overhead |
| ------------------- | ----: | ----: | ------: | ---------: | -------: |
| Final check         |     1 | 1 / 1 |   0 / 0 |      0 / 0 |    3 / 3 |
| Serial verification |   149 | 2 / 2 | 30 / 62 |  131 / 615 |    3 / 5 |
| build-browser       |     1 | 2 / 2 | 61 / 61 |  417 / 417 |    5 / 5 |
| static              |     1 | 1 / 1 | 21 / 21 |    24 / 24 |    3 / 3 |
| unit-database       |     1 | 2 / 2 | 33 / 33 |  101 / 101 |    5 / 5 |

## Most expensive task steps

| Step                 | Total runner minutes |
| -------------------- | -------------------: |
| Run npm run test:e2e |                284.9 |
| Run npm run test     |                132.4 |
| Run npm run build    |                 22.6 |
| Run npm run lint     |                 18.5 |
| Run npm run knip     |                  3.9 |

The window includes 4 successful PR runs. Their end-to-end p50 / p95 was 655 / 725 seconds. The small sample spans different workflow versions.

The sample used 556.7 runner-minutes. Browser tests consumed 284.9 minutes (51.2%). The selected changes target browser setup and duplicated browser work. Queue time met the ten-second target at p95.

[Every job and its GitHub log](jobs.csv) · [Timestamped steps](steps.csv) · [Workflow durations](runs.csv)

During development, run the Playwright spec for the journey you changed. Before merging to main, CI runs the full desktop and mobile matrix.
