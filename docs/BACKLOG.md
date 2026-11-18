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

## Working agreement
- Each PR references exactly the relevant issue(s), records acceptance criteria, and marks which existing feature is reused.
- Do not close an issue simply because a PR merged; verify the acceptance checklist and deployment.
- Update the issue when scope or status changes. Do not create a second issue for the same unfinished task.
- For marketplace metadata, avoid bypassing access restrictions; confirm program permissions and image reuse rights.
