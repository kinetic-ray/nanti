# Affiliate Center

## Enable administrator sign-in

The Affiliate Center uses one environment-configured administrator. Wishlist browser sessions and administrator sessions are separate.

1. Install dependencies and build with `npm ci` and `npm run build`.
2. Configure the intended database in `DATABASE_URL` and keep the existing `SESSION_SECRET`. Apply the migrations with `npm run db:migrate`.
3. Run `npm run db:index-products` to link eligible products saved before Phase 3. The command can be repeated and preserves saved links and assessments. A deployed build can also run `node --env-file-if-exists=.env dist/server/backfill-identities.js`.
4. Run `npm run admin:hash` in a terminal. Enter the password twice at the hidden prompts. Use at least 16 characters and keep the password in a password manager.
5. Set `NANTI_ADMIN_USERNAME` to a 3–64 character identifier using letters, digits, dots, underscores, or hyphens. Set `NANTI_ADMIN_PASSWORD_HASH` to the full string printed by the hash command. Keep both settings in the server’s secret configuration. In production, set `NODE_ENV=production` and serve Nanti over HTTPS.
6. Restart the app and sign in at `/admin`.

Leaving both administrator variables empty disables sign-in. Changing the configured username, hash, or session secret invalidates previous administrator sessions. Approved links remain active until disabled, revoked, or invalidated.

Administrator passwords use Node’s scrypt with a random salt. The application stores hashes of random, expiring session tokens and uses a separate HTTP-only, SameSite=Strict cookie with the Secure and host-prefix protections in production. Mutation requests require the application’s JSON request header. Login rate limiting is per server process, so a multi-replica deployment needs a shared edge limit. [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

## Review and publish a mapping

- **Opportunities** groups saved occurrences by recognized merchant listing and shows the public listing, coverage, and review history. Counts are aggregates. Custom wishlist names, item labels, assessments, and financial information stay out of the queue.
- Add the actual link provided by your affiliate program. Examine both merchant pages and confirm the product, article number, sales market, and relevant variants. Record the real title, known attributes, and evidence. Approve only after confirming the link and variant.
- An identity can have one active mapping. Revalidation records a new check. Disable pauses a mapping. Revoke or mark invalid removes it from use. Candidate creation, verification, approvals, and status changes appear in the history with actor and time.
- The **Inbox** shows new opportunities, candidates needing review, revoked mappings, and invalidations. Each event opens its product. It can be marked read, marked unread, or dismissed.

The first verifier recognizes direct IKEA article links under `www.ikea.com`. It keeps the article path and market distinct, strips only recognized attribution for identity matching, and requires exact agreement plus documented administrator approval before publication. Unknown parameters, opaque affiliate URLs, different markets, ambiguous variants, and other merchants use the original product link. A tracking parameter is a link-format signal. Program authorization and commission terms come from the administrator’s affiliate program. [IKEA article identifiers](https://www.ikea.com/se/en/customer-service/knowledge/articles/51839f35-2f11-4337-b1d2-g955c9580fce.html)

Verification is manual. Merchant content and redirects can change after a review. Check active destinations periodically and revoke a mapping that no longer points to the confirmed item. The resolver rechecks local identity and approval at the point of use. If approval changed after a shopper opened the dialog, the original link is used. If the saved item itself changed, the shopper is asked to reopen its details.

## Verify locally

Point `TEST_DATABASE_URL` at a migrated isolated MySQL database and run `npm test`. For browser verification, start a local built app with test administrator credentials and an isolated database. Set `NANTI_TEST_ADMIN_USERNAME` and `NANTI_TEST_ADMIN_PASSWORD` to the matching disposable credentials, then run `npm run test:browser:affiliate`. The browser test verifies its synthetic link destinations through the local app without navigating to the merchant.
