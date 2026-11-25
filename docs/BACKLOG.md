# Nanti — Execution backlog (18 Nov 2026)

GitHub Issues are the source of truth for remaining work. Before opening a PR, search for an existing issue and merged PR to avoid duplicate implementation.

## Status vocabulary
- `P0`: core stability or blocking product intake
- `P1`: revenue, retention and operations
- `P2`: expansion / validation
- `[done]`: only after code merged **and** acceptance criteria tested; a merged PR alone is not proof of completion

## Execution order
1. **P0 — Stabilization**: #11 — Android Back regression, nested modals, picker cancel, persistent optional image uploads, mobile QA. Reuse PR #3/#4/#5/#6/#9/#10.
2. **P0 — Marketplace import**: #12 — authorized Shopee/Tokopedia link resolution, extraction, observable fallback. Reuse PR #1/#2/#7/#8.
3. **P1 — Affiliate revenue**: #13 — authorized integration, existing admin approval and analytics.
4. **P1 — Retention**: #14 — authorized automatic price sources and notifications. Manual price tracking and in-app alerts already exist.
5. **P1 — Operations**: #15 — production diagnostics, Telegram decision, CI and release QA. May be done incrementally with steps 1–4.
6. **P2 — Creator validation**: #16 — test creator demand and minimal lookbook before implementation.
7. **P2 — Monetization**: #17 — decide pricing and subscriptions after creator validation.

## Sprint handoff — 25 Nov 2026

| Sprint | Status | References |
| --- | --- | --- |
| 1 — Affiliate Management | Completed | [#85](https://github.com/kinetic-ray/nanti/pull/85), [#87](https://github.com/kinetic-ray/nanti/pull/87) |
| 2 — Recommendation Management | Completed | [#88](https://github.com/kinetic-ray/nanti/pull/88) |
| 3 — Catalog and Marketplace Hardening | Completed | [#90](https://github.com/kinetic-ray/nanti/pull/90) |
| 4 Phase 1 — Shopee Embedded State Extraction | Deployed | [#91](https://github.com/kinetic-ray/nanti/pull/91), [CI](https://github.com/kinetic-ray/nanti/actions/runs/45528343068) |
| 4 Phase 2 — Shopee Short-Link Resolution | Deployed | [#92](https://github.com/kinetic-ray/nanti/pull/92), [CI](https://github.com/kinetic-ray/nanti/actions/runs/45530693073) |
| 4 Phase 3 — Authorized Price Extraction | Research complete. Blocked pending Shopee Affiliate Open API approval. | [Research and access requirements](SHOPEE_RESEARCH.md) |
| 4 Phase 4 — Integration Validation | Next available task | Verify direct and short links, blocked-listing manual fallback, catalog deduplication, purchase links, and saved images. Use fixtures or authorized public checks and keep Shopee price extraction disabled. |
| 5 — Production Reliability | Postponed | Resume after the next sprint decision. |
| 6 — Recommendation Engine | Postponed | Resume after the next sprint decision. |

Phase 2 validation included 113 targeted tests with `nanti_dev`, typecheck, and three passing consolidated CI jobs. Phase 4 should reuse those results and cover gaps in deployment and integration behavior without changing production data.

PR [#32](https://github.com/kinetic-ray/nanti/pull/32) remains blocked pending authorized provider validation. Drafts [#66](https://github.com/kinetic-ray/nanti/pull/66) and [#79](https://github.com/kinetic-ray/nanti/pull/79) were superseded by #67 and #92, respectively. Their branches are retained, alongside the creator design experiment and Tokopedia redirect investigation.

## Historical progress snapshot — 18 Nov 2026
- **#11 P0 — PARTIAL / R2 PAUSED BY USER**: PRs #19–#24 merged, including object-storage image references, Android JPEG compression, CSP and CI checks. User reports the TiDB SQL Editor migration query ran successfully against `nanti`; actual `imageKey` column and `_prisma_migrations` checksum consistency still require independent verification. R2 bucket, credentials, CORS, Vercel configuration, redeploy, Android end-to-end QA and image persistence checks remain pending. **Do not run a second ALTER TABLE blindly.** Resume R2 only when user requests it.
- **#12 P0 — PARTIAL**: PR #25 merged and CI passed. Shopee/Tokopedia preview is no longer incorrectly gated on IKEA permission. Real-world shortlink, redirect, blocked-page and fallback acceptance still pending.
- **#13 P1 — OPEN**: official affiliate integration and conversion attribution pending.
- **#14 P1 — OPEN**: authorized automatic price monitoring and notifications pending; manual tracking exists.
- **#15 P1 — PARTIAL**: PR #22 merged, CI typecheck/test/build and CSP/rate-limit improvements; production diagnostics, alerting and release QA pending.
- **#16/#17 P2 — DEFERRED** until P0/P1 priorities are addressed.

## Working agreement
- Each PR references exactly the relevant issue(s), records acceptance criteria, and marks which existing feature is reused.
- Do not close an issue simply because a PR merged; verify the acceptance checklist and deployment.
- Update the issue when scope or status changes. Do not create a second issue for the same unfinished task.
- For marketplace metadata, avoid bypassing access restrictions; confirm program permissions and image reuse rights.
