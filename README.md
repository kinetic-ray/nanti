# nanti.

Simpan dulu. Putuskan nanti.

Nanti is a wishlist and purchase-planning app. Phase 1 supports private wishlists, saved product links, quantities, optional unit prices, and exact totals for known prices. Each wishlist uses one currency. Product-name lookup accepts supported IKEA links. You can enter details manually for any link or save a product without a link.

## Purchase tools

- Open **Purchase tools** on a product to reflect on buying impulse or check whether it fits your budget.
- Open **Compare products** on a wishlist to rank two to six products using your own criteria, weights, and ratings.
- Open **Check wishlist timing** to choose included items, mark optional items, and pick at most one product from each alternative group. The total uses the saved quantities. A partial quote shows a known subtotal and accepts a full estimate.

Each tool explains its result and links to its versioned methodology. You can save a check and revisit its purchase snapshot and result. **Needs review** explains changes to relevant products, quantities, selections, or calculation versions. Rechecking with current data creates a new entry only when you save it. Timing rechecks require you to confirm current financial details.

The public interface defaults to Indonesian and remembers the ID/EN selection on this device. [Design system](docs/DESIGN_SYSTEM.md)

Product details offer **Buy product**. A disclosed affiliate destination requires a verified mapping for the saved listing and variant. Shoppers can also open their original product link.

## Affiliate Center

Administrators can review aggregated product opportunities, verify affiliate mappings, and manage the notification inbox at `/admin`. See [administrator setup and verification](docs/AFFILIATE_CENTER.md) for credentials, migrations, indexing, and browser tests.

## Consumer accounts

Guest mode is available on the same browser as before. Sign in with Google or Apple to access the same wishlists and saved assessments across devices. The account screen lets you import eligible guest data, edit your display name, connect another provider, or delete the account. Administrator credentials still work separately at `/admin`.

Configure either provider independently. The setup guide includes callback URLs, environment variables, migration and recovery steps, and smoke tests. [Consumer authentication setup](docs/AUTHENTICATION.md)

## Privacy and retention

Saved assessments and waiting preferences are private to your account when signed in, or to your signed browser session as a guest. A saved timing check contains the selected products, quantities, purchase costs and planning dates, a limited result summary, and server-keyed fingerprints for balances, bills, reserve, and savings. The amounts behind those fingerprints are cleared when you close the check. You can see which fields changed after you re-enter them.

Use **Privacy and history** to delete all saved assessments and the waiting preference under your current account or guest session. You can also delete individual results. Removing a product deletes its item-level checks. Wishlist-level comparison and timing snapshots remain available for review until you delete the history entry or its wishlist. The server clears saved assessments and unused waiting preferences after 365 days at startup and in its daily cleanup.

## Run locally

Use Node.js 22.12+ and a MySQL-compatible database that supports foreign keys. Create an empty database and a database user with access to it.

1. Run `npm ci` to install dependencies and generate the Prisma client.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` using the form `mysql://USER:PASSWORD@HOST:3306/DATABASE` and URL-encode special characters in the credentials. Generate a stable session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `SESSION_SECRET`.
3. Run `npm run db:migrate` to apply the schema.
4. Run `npm run dev:api` and `npm run dev` in separate terminals. Open the URL Vite prints. Its development proxy expects the API on port 3000.

Guest wishlist ownership follows a signed, HttpOnly cookie. Use the same browser profile to reopen guest wishlists and assessments. Clearing site data or changing the session secret removes that browser’s access to unimported guest records. Sign in again with a connected provider to reopen account data.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

The default tests cover the purchase algorithms, HTTP validation, wishlist API, money and URL validation, and product lookup. To verify Prisma persistence, consumer authentication with mocked providers, ownership, history pagination, and cascading deletes, migrate a separate test database and set `TEST_DATABASE_URL` to its connection URL before running `npm test`. Use a test database because the suite writes and deletes records.

For browser regression checks, run the built app locally with an isolated database and run `npm run test:browser`. Set `NANTI_BROWSER_BASE_URL` if the app uses a different loopback URL and `NANTI_BROWSER_PATH` if Chromium is outside the default Windows Chrome location. On other platforms use an installed Chromium or the Playwright Chromium binary. Set `NANTI_BROWSER_ARTIFACTS` to capture screenshots. The test creates and deletes its own wishlist.

Run `npm run test:browser:accounts` after building, with `TEST_DATABASE_URL` pointing to a migrated loopback database whose name ends with `_test`. It runs an isolated app with mocked Google responses and checks authentication, account UX, and guest import at mobile widths. [Affiliate browser verification](docs/AFFILIATE_CENTER.md)

Run `npm run test:browser:visual` against a local app on an isolated database to check the public UI at 360, 390, 430, 768, 1280, and 1440 CSS pixels. Set `NANTI_BROWSER_ARTIFACTS` to write screenshots. The fixture uses supported IKEA listings and checks fallbacks when the retailer is unavailable.

## Run the built app

After building and migrating, run `npm start`. Express serves both the frontend and API on the configured host and port. For production, set `NODE_ENV=production`, serve the app through HTTPS, and use a TLS-protected database connection when the database is reachable over the network.
