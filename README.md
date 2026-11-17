# nanti.

Simpan dulu. Putuskan nanti.

Nanti is a wishlist and purchase-planning app. Phase 1 supports private wishlists, saved product links, quantities, optional unit prices, and exact totals for known prices. Each wishlist uses one currency. Product-name lookup accepts supported IKEA links. You can enter details manually for any link or save a product without a link.

## Purchase tools

- Open **Purchase tools** on a product to reflect on buying impulse or check whether it fits your budget.
- Open **Compare products** on a wishlist to rank two to six products using your own criteria, weights, and ratings.
- Open **Check wishlist timing** to choose included items, mark optional items, and pick at most one product from each alternative group. The total uses the saved quantities. A partial quote shows a known subtotal and accepts a full estimate.

Each tool explains its result and links to its versioned methodology. You can save a check and revisit its purchase snapshot and result. **Needs review** explains changes to relevant products, quantities, selections, or calculation versions. Rechecking with current data creates a new entry only when you save it. Timing rechecks require you to confirm current financial details.

The public interface defaults to Indonesian and remembers the ID/EN selection on this device. [Design system](docs/DESIGN_SYSTEM.md)

## Privacy and retention

Saved assessments and waiting preferences belong to the signed browser session. A saved timing check contains the selected products, quantities, purchase costs and planning dates, a limited result summary, and server-keyed fingerprints for balances, bills, reserve, and savings. The amounts behind those fingerprints are cleared when you close the check. You can see which fields changed after you re-enter them.

Use **Privacy and history** to delete all saved assessments and the waiting preference for this browser. You can also delete individual results. Removing a product deletes its item-level checks. Wishlist-level comparison and timing snapshots remain available for review until you delete the history entry or its wishlist. The server clears saved assessments and unused waiting preferences after 365 days at startup and in its daily cleanup.

## Run locally

Use Node.js 22.12+ and a MySQL-compatible database that supports foreign keys. Create an empty database and a database user with access to it.

1. Run `npm ci` to install dependencies and generate the Prisma client.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` using the form `mysql://USER:PASSWORD@HOST:3306/DATABASE` and URL-encode special characters in the credentials. Generate a stable session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `SESSION_SECRET`.
3. Run `npm run db:migrate` to apply the schema.
4. Run `npm run dev:api` and `npm run dev` in separate terminals. Open the URL Vite prints. Its development proxy expects the API on port 3000.

Wishlist ownership follows a signed, HTTP-only cookie. Use the same browser profile to reopen your wishlists and assessments. Clearing site data or changing the session secret removes that browser’s access to its previous records.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

The default tests cover the purchase algorithms, HTTP validation, wishlist API, money and URL validation, and product lookup. To verify Prisma persistence, ownership, history pagination, and cascading deletes, migrate a separate test database and set `TEST_DATABASE_URL` to its connection URL before running `npm test`. Use a test database because the suite writes and deletes records.

For browser regression checks, run the built app locally with an isolated database and run `npm run test:browser`. Set `NANTI_BROWSER_BASE_URL` if the app uses a different loopback URL and `NANTI_BROWSER_PATH` if Chromium is outside the default Windows Chrome location. On other platforms use an installed Chromium or the Playwright Chromium binary. Set `NANTI_BROWSER_ARTIFACTS` to capture screenshots. The test creates and deletes its own wishlist.

## Run the built app

After building and migrating, run `npm start`. Express serves both the frontend and API on the configured host and port. For production, set `NODE_ENV=production`, serve the app through HTTPS, and use a TLS-protected database connection when the database is reachable over the network.
