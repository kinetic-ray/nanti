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

## Progress snapshot — 18 Nov 2026
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
