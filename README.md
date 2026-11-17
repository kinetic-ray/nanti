# nanti.

Save what you want. Decide when to buy.

Nanti is a wishlist and purchase-planning app. Phase 1 supports private wishlists, saved product links, quantities, optional unit prices, and exact totals for known prices. Each wishlist uses one currency. Product-name lookup accepts supported IKEA links. You can enter details manually for any link or save a product without a link.

## Purchase tools

- Open **Purchase tools** on a product to reflect on buying impulse or check whether it fits your budget.
- Open **Compare products** on a wishlist to rank two to six products using your own criteria, weights, and ratings.
- Open **Check wishlist timing** to plan for the full wishlist, including quantities and any extra costs you enter.

Each tool explains its result and links to its versioned methodology. Saved impulse checks, comparison configurations, and waiting preferences belong to the existing browser session. Retakes and revised comparisons create new history entries. Draft impulse answers and comparisons stay in memory until the page is reloaded. Financial inputs and timing results are cleared when you close the check.

## Run locally

Use Node.js 22.12+ and a MySQL-compatible database that supports foreign keys. Create an empty database and a database user with access to it.

1. Run `npm ci` to install dependencies and generate the Prisma client.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` using the form `mysql://USER:PASSWORD@HOST:3306/DATABASE` and URL-encode special characters in the credentials. Generate a stable session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `SESSION_SECRET`.
3. Run `npm run db:migrate` to apply the schema.
4. Run `npm run dev:api` and `npm run dev` in separate terminals. Open the URL Vite prints. Its development proxy expects the API on port 3000.

Wishlist ownership follows a signed, HTTP-only cookie. Use the same browser profile to reopen your wishlists. Clearing site data or changing the session secret removes access to existing wishlists.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

The default tests cover the purchase algorithms, HTTP validation, wishlist API, money and URL validation, and product lookup. To verify Prisma persistence, ownership, history pagination, and cascading deletes, migrate a separate test database and set `TEST_DATABASE_URL` to its connection URL before running `npm test`. Use a test database because the suite writes and deletes records.

## Run the built app

After building and migrating, run `npm start`. Express serves both the frontend and API on the configured host and port. For production, set `NODE_ENV=production`, serve the app through HTTPS, and use a TLS-protected database connection when the database is reachable over the network.
