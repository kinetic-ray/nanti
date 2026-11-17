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
3. For local Vite development, register `http://127.0.0.1:5173/api/account/google/callback` and set `AUTH_PUBLIC_ORIGIN=http://127.0.0.1:5173`. Open that exact origin. When serving the built app directly on a different port, register that port and set the origin accordingly.
4. Set `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. The server requests `openid profile`, uses S256 PKCE, and retains the stable identity key and an optional verified display name.

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

Consumer sessions expire after 30 days and sign-out invalidates the selected session immediately. Connecting another provider and deleting an account require provider sign-in or verification in the preceding ten minutes. A verified provider subject binds each identity to one Nanti user. Nanti does not link identities by email or store provider access tokens, refresh tokens, email addresses, or ID tokens.

Guest import needs both the signed guest cookie from sign-in and the authenticated session on the same browser. The user reviews the count and confirms first. Import associates the existing guest ownership with the account in one transaction. Wishlist IDs, original product references, and existing assessment snapshots remain intact. Lists with duplicate names remain separate. An existing account cooling-off preference takes precedence over the guest preference. Guest data remains under its original guest session if import is skipped.

Deleting the Nanti account removes account-owned and imported wishlists, products saved within those wishlists, assessments, preferences, provider identities, and every consumer session. Unimported guest wishlists and global affiliate data remain available. Apple authorization can be removed separately in the Apple Account settings. This web integration does not retain Apple OAuth tokens for automatic revocation or receive Apple revocation notifications. [Apple account access settings](https://support.apple.com/en-us/102571) · [Apple token revocation guidance](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)

## Automated checks

Run `npm test` with `TEST_DATABASE_URL` set to a disposable migrated database. OAuth tests use generated signing keys and stubbed token and key responses for both providers. Run `npm run typecheck` and `npm run build`, then `npm run test:browser:accounts` against a loopback test database with a name ending in `_test`. The browser suite uses a local server and mocked Google responses. Live provider sign-in requires configured credentials and deployment-specific testing.
