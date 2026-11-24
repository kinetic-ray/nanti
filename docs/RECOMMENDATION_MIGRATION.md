# Recommendation workspace migration

## Sprint 2 release

Apply `20261125100000_recommendation_workspace` after
`20261125000000_catalog_provenance_and_direct_replacement`. It adds six nullable
columns to `CuratedRecommendation`: the shared identity foreign key, resolved
listing URL, imported title, imported thumbnail URL, imported price timestamp,
and archive timestamp. The unique identity index prevents concurrent duplicate
curation. Existing rows keep their publication and price confirmation state.
Refreshing a supported existing listing can associate it with its shared identity.

Apply the additive schema before the Sprint 2 application serves requests. The
production migration workflow requires a verified restorable backup and explicit
authorization. Verify migration status after deployment. To roll back the
application, keep the additive schema and redeploy the previous code. Sprint 2
archive and restore write `published = false` so the prior consumer code also
excludes those rows. Dropping the new fields would discard curation provenance
and archive history and needs a separately reviewed migration.

The recommendation workspace shares the existing Superadmin session and only
mounts when `NANTI_RECOMMENDATION_SUPERADMIN_USERNAME` matches
`NANTI_ADMIN_USERNAME`. The existing retailer metadata and price permissions
still apply. The workspace keeps the entered URL and the resolved listing
separately. Thumbnails use the public importer path or a retailer image URL.
Curation never writes personal wishlist items, image uploads or price history.

Active entries join the existing on-demand Kabar alternatif candidate query.
Existing matching, currency, safety and seven-day price eligibility still apply.
An entry can be published while marketplace price is missing. It enters matching
after eligible price metadata is imported. Restore returns an entry to draft.
Publishing through the workspace does not scan existing pending requests or send
inbox notices. The existing legacy request and inbox paths remain available.
No data backfill is needed.

## Historical V1 notes


PR: #71 · Issue: #70 · Branch: `feat/issue-70-recommendation-management`

## Current state
- Schema and two additive SQL migrations are committed, **not applied to production**.
- GitHub Actions workflow `recommendation-migration-check.yml` is intended to validate migrations on disposable MySQL 8, without production secrets. The workflow now also runs a real MySQL persistence smoke test for catalog, cursor, request claims, deduplication and read state.
- Superadmin endpoints are disabled by default. To enable them in a controlled environment, set `NANTI_RECOMMENDATION_SUPERADMIN_USERNAME` equal to the configured `NANTI_ADMIN_USERNAME`. This is a feature-specific gate for the existing single-admin credential model, **not a complete multi-role RBAC implementation**.
- Do not deploy or merge before the checks below pass.

## Before merging
1. Verify the workflow actually runs and passes; inspect logs for Prisma schema validation, migrate deploy, drift, typecheck and unit tests. Workflow file existence is not evidence of success.
2. Run `npm ci`, `npx prisma validate`, `npm run typecheck`, `npm run build`, `npm test` locally.
3. Confirm the disposable MySQL workflow succeeds, including the persistence smoke test. Concurrency and database failure-injection tests remain additional validation, not covered by the smoke test.
4. Verify existing admin login and cookie-based CSRF protections, plus the explicit superadmin gate. Confirm non-admin and disabled-gate requests cannot mutate the catalog.
5. Complete the UI wiring, price freshness/provenance, safe marketplace import, notification delivery and retry flow, and browser accessibility checks.
6. Confirm no production migration or deployment is triggered by preview CI. Keep the PR Draft until all criteria are met.

## Known limitations
- Price confirmation is manual, with a seven-day freshness TTL; no authoritative automated price verification.
- Product classification is conservative and text-based, not image-based.
- Fulfillment currently runs in the publishing request and should be moved to a retryable queue/worker for scale.
- An in-app notification inbox is wired, but cross-device push/email delivery is not implemented.
- Curated catalog images are not yet persisted or displayed; text, price, and product links remain usable.\n- The single configured administrator identity is not a general-purpose RBAC model.
