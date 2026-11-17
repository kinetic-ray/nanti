# nanti.

Save what you want. Decide when to buy.

Nanti is a wishlist and purchase-planning app. Phase 1 supports private wishlists, saved product links, quantities, optional unit prices, and exact totals for known prices. Each wishlist uses one currency. Product-name lookup accepts supported IKEA links. You can enter details manually for any link or save a product without a link.

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

The default tests cover the API contract, money and URL validation, and lookup behavior. To run the same API contract against Prisma and verify database cascade behavior, migrate a separate test database and set `TEST_DATABASE_URL` to its connection URL before running `npm test`. Use a test database because the suite writes and deletes records.

## Run the built app

After building and migrating, run `npm start`. Express serves both the frontend and API on the configured host and port. For production, set `NODE_ENV=production`, serve the app through HTTPS, and use a TLS-protected database connection when the database is reachable over the network.
