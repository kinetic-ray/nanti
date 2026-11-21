# Consumer authentication

Guest mode works with both providers disabled. One or both providers can be configured independently. Open `/account` or use the account button in Nanti. Authenticate twice in separate browser profiles with the same provider identity to reopen the same account. Use **Connect** inside a recently verified account to add the other provider.

## Server environment

| Variable | Value |
| --- | --- |
| `AUTH_PUBLIC_ORIGIN` | The exact origin serving the UI and API, such as `https://nanti.example.com`. Provide a scheme, domain, and optional port. Required when a provider is enabled. |
| `AUTH_GOOGLE_CLIENT_ID` | OAuth web application client ID |
| `AUTH_GOOGLE_CLIENT_SECRET` | OAuth web application client secret |
| `AUTH_APPLE_CLIENT_ID` | Sign in with Apple Services ID |
| `AUTH_APPLE_TEAM_ID` | Apple Developer Team ID |
| `AUTH_APPLE_KEY_ID` | ID of the Sign in with Apple signing key |
| `AUTH_APPLE_PRIVATE_KEY_BASE64` | Standard base64 of the full PKCS#8 `.p8` file, on one line |
| `SESSION_SECRET` | Existing stable Nanti secret for signed guest cookies, financial fingerprints and admin session scope |
| `NODE_ENV` | Set to `production` on public deployments |
| `NANTI_TRUST_PROXY` | Optional IP address of the directly connected reverse proxy |

Set all credentials for each enabled provider. Store values in the server secret store or an untracked local environment file. Keep the original Apple key in secure storage. To encode it locally, run `node -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))" path/to/key.p8` and place the output in the server secret store.

### Google Cloud

1. Select a Google Cloud project. Configure **Google Auth Platform → Branding** and **Audience** with the app name, support contact, and intended audience. Add test users if using external testing mode.
2. In **Clients**, create an OAuth client of type **Web application**. Under **Authorized redirect URIs**, add `https://nanti.example.com/api/account/google/callback`, replacing the example origin with the exact deployed origin. The callback uses GET.
3. For local Vite development with `AUTH_PUBLIC_ORIGIN=http://localhost:5173`, register `http://localhost:5173/api/account/google/callback` and open `http://localhost:5173`. If you configure `http://127.0.0.1:5173` instead, register `http://127.0.0.1:5173/api/account/google/callback` and use that browser address. The attempt cookie is host-only, and the browser origin must match the configured scheme, host, and port. When using a different port, update both values accordingly.
4. Set `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. The server requests `openid profile email` and uses S256 PKCE. During development, look for `OAuth sign-in failed` in the API console. The entry identifies the failure phase, such as an origin mismatch, a missing browser cookie, an expired attempt, or token exchange failure. It includes no credential or callback payload.

[Google Workspace OAuth credentials](https://developers.google.com/workspace/guides/create-credentials) · [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

### Apple Developer

1. In **Certificates, Identifiers & Profiles**, enable **Sign in with Apple** for a primary App ID under your team. Register a **Services ID** and associate it with that App ID.
2. In the Services ID's **Sign in with Apple** configuration, register the web domain and the exact return URL `https://nanti.example.com/api/account/apple/callback`. Use a registered HTTPS domain. Apple rejects localhost and literal IP addresses. The callback receives a cross-site form POST.
3. Create a key enabled for **Sign in with Apple**, configure it for the primary App ID, and download the `.p8` file. Set the Services ID, Team ID, Key ID, and base64-encoded private key in the Apple variables above.
4. Run with the configured HTTPS origin. The server signs a short-lived Apple client secret for token exchange. Apple’s documented web authorization parameters do not include PKCE. The flow binds signed identity claims to a one-use nonce and a browser-bound state and exchanges the authorization code as a confidential client. Nanti requests no email or name scopes from Apple, so private relay addresses and missing names have no effect on account matching.

[Configure Apple web sign-in](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/) · [Apple authorization request](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.)

## Deploy and verify

1. Take a restorable backup of the current database. Run the five migrations in order on an isolated MySQL copy, then verify counts and sampled rows for wishlists, products, assessments, preferences, product identities and affiliate mappings. Phase 3 is `20261118030000_product_identity_affiliate`. Phase 3A is `20261118040000_consumer_accounts`.
2. For a release, stop old app writers during migration and run `npm run db:migrate` with the migration database account. Deploy the updated app afterwards. The old app cannot create ownership rows for newly generated guest IDs. Phase 3A creates the account tables and seeds ownership IDs from existing wishlists and standalone preferences before adding foreign keys. IDs, purchase inputs, and affiliate mappings are preserved.
3. Give the runtime database account only the app schema's required data access. Use a separate migration role for DDL, TLS for remote database traffic, and restricted access to backups. Keep `SESSION_SECRET`, the hostname, and the existing production cookie mode stable during the upgrade.
4. Serve the UI and API over the configured HTTPS origin. Forward the Apple callback’s POST body and both providers’ cookies. Exclude callback query strings and bodies and start response bodies from logs and analytics. The app applies per-process rate limits. For a directly connected reverse proxy, set `NANTI_TRUST_PROXY` to its actual IP and configure it to overwrite incoming forwarding headers. Add a shared edge limit for multiple app instances.
5. Restart with the configured credentials. Test a first sign-in, cancellation, returning sign-in, and a guest import. Verify imported data in a second browser profile, link the second provider from the account screen, and confirm account deletion from a test account. Use a real test Apple account on the registered HTTPS domain to verify the cross-site cookie in your deployment.

If provider setup causes a release problem, clear that provider’s credential group and restart the Phase 3A runtime. Keep a working provider enabled for customers who use it. Preserve the Phase 3A tables and account ownership if users have already signed in or imported data. A full Phase 3 rollback requires a coordinated restore of the pre-upgrade backup and old app, with an explicit plan for writes made since the backup. MySQL DDL can commit partially. If a migration fails, check `_prisma_migrations` and the actual schema on an isolated copy before deciding whether to restore or resolve and retry.

## Sessions, guest import, and deletion

Consumer sessions expire after 30 days and sign-out invalidates the selected session immediately. Connecting another provider and deleting an account require provider sign-in or verification in the preceding ten minutes. A verified provider subject binds each identity to one Nanti user. Nanti uses provider subjects for identity matching and stores verified Google email only for account display. Provider access tokens, refresh tokens, and ID tokens are discarded.

Guest import needs both the signed guest cookie from sign-in and the authenticated session on the same browser. The user reviews the count and confirms first. Import associates the existing guest ownership with the account in one transaction. Wishlist IDs, original product references, and existing assessment snapshots remain intact. Lists with duplicate names remain separate. An existing account cooling-off preference takes precedence over the guest preference. Guest data remains under its original guest session if import is skipped.

Deleting the Nanti account removes account-owned and imported wishlists, products saved within those wishlists, assessments, preferences, provider identities, and every consumer session. Unimported guest wishlists and global affiliate data remain available. Apple authorization can be removed separately in the Apple Account settings. This web integration does not retain Apple OAuth tokens for automatic revocation or receive Apple revocation notifications. [Apple account access settings](https://support.apple.com/en-us/102571) · [Apple token revocation guidance](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)

## Automated checks

Run `npm test` with `TEST_DATABASE_URL` set to a disposable migrated database. OAuth tests use generated signing keys and stubbed token and key responses for both providers. Run `npm run typecheck` and `npm run build`, then `npm run test:browser:accounts` against a loopback test database with a name ending in `_test`. The browser suite uses a local server and mocked Google responses. Live provider sign-in requires configured credentials and deployment-specific testing.

## Account administration

Open `/admin?view=accounts` to sign in with Google and access the dashboard. The existing Affiliate Center remains at `/admin` with its existing credentials. The account dashboard exposes a read-only profile, the 50 newest user records and the 50 newest sign-in and sign-out events. Activity records start with this release and are eligible for deletion by account retention cleanup after 90 days. Account deletion removes the link between the account and its activity records.

Apply `20261121120000_account_admin` before serving this version. It adds an optional return destination to OAuth attempts, adds a role with a default of `member` to every account, and creates a new activity table. The migration also indexes account creation time for the recent-user list.

An operator with database write access provisions an administrator after the intended user first signs in. Verify the internal Nanti account ID and its Google identity binding through an independent trusted channel. Display names are user-editable and Google email addresses are not used for provisioning. Use bound values for 'verified-account-uuid' in your database client. Cancel the transaction if the role update does not affect exactly one row.

```sql
START TRANSACTION;
UPDATE `User` AS u
SET role = 'admin'
WHERE u.id = 'verified-account-uuid' AND u.role = 'member'
  AND EXISTS (
    SELECT 1 FROM AuthIdentity AS i WHERE i.userId = u.id AND i.provider = 'google'
  );
DELETE FROM UserSession WHERE userId = 'verified-account-uuid';
COMMIT;
```

The administrator signs in again after provisioning. Access belongs to the Nanti account, including any other sign-in method linked to it. To revoke access, set the role back to `member` and revoke that user's sessions in the same transaction. Record role grants and revocations in your operator change log. The app checks the current database role and session expiry on every dashboard request.


## Password accounts and Creator onboarding

Password registration requires verification before login. Recovery links are single use and expire. The verification form also asks for the password chosen at registration. Password reset and change revoke all sessions for the affected Nanti account. Google can provide a verified email for profile display. Google matching still uses the provider subject independently of password email addresses.

Set `NANTI_DEV_ACCOUNT_MAIL=file` in the ignored local environment file with `NODE_ENV=development` and a loopback HTTP origin. The application appends local verification and reset links to the ignored `.env.account-outbox` file. Keep this file private and remove it manually after use. Production registration and email recovery require a transactional mail provider.

Apply `20261121130000_password_creator_accounts` before serving this version. It adds password credentials, expiring action tokens, Creator onboarding progress and one Creator profile per account. Existing identities, sessions and wishlists stay in place. Apply `20261121140000_creator_page_drafts` as well. Saved Studio designs belong to the authenticated Creator profile. The old, unowned preview key remains in browser storage.

Signed-in users can open Creator Studio from their account. New creators enter the name shown on their storefront. Apply migration `20261122110000_creator_catalog` before serving the catalog and public storefront routes. The migration assigns existing creators stable storefront links and keeps storefronts private until publication.
