# Recommendation Management V1 — Migration and rollout checklist

PR: #71 · Issue: #70 · Branch: `feat/issue-70-recommendation-management`

## Current state
- Schema and SQL migration are committed, **not applied to production**.
- GitHub Actions workflow `recommendation-migration-check.yml` is intended to validate migrations on disposable MySQL 8, without production secrets.
- Superadmin endpoints are disabled by default. To enable them in a controlled environment, set `NANTI_RECOMMENDATION_SUPERADMIN_USERNAME` equal to the configured `NANTI_ADMIN_USERNAME`. This is a feature-specific gate for the existing single-admin credential model, **not a complete multi-role RBAC implementation**.
- Do not deploy or merge before the checks below pass.

## Before merging
1. Verify the workflow actually runs and passes; inspect logs for Prisma schema validation, migrate deploy, drift, typecheck and unit tests. Workflow file existence is not evidence of success.
2. Run `npm ci`, `npx prisma validate`, `npm run typecheck`, `npm run build`, `npm test` locally.
3. Apply the migration to an isolated MySQL clone; verify all three tables and constraints; test idempotent request upsert and notification uniqueness under concurrency.
4. Verify existing admin login and cookie-based CSRF protections, plus the explicit superadmin gate. Confirm non-admin and disabled-gate requests cannot mutate the catalog.
5. Complete the UI wiring, price freshness/provenance, safe marketplace import, notification delivery and retry flow, and browser accessibility checks.
6. Confirm no production migration or deployment is triggered by preview CI. Keep the PR Draft until all criteria are met.

## Known limitations
- Price confirmation is currently manual; there is no authoritative automated verification or freshness TTL.
- Product classification is conservative and text-based, not image-based.
- Fulfillment currently runs in the publishing request and should be moved to a retryable queue/worker for scale.
- In-app notification delivery is not yet connected to a consumer notification surface.
- The single configured administrator identity is not a general-purpose RBAC model.
