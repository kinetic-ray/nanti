# Nanti MVP operations

## Local development

1. Install Node.js 22.12+ and start MySQL. Use a dedicated development database and user on a loopback host.
2. Run `npm ci`. Copy `.env.example` to `.env` if settings are absent. Set `DATABASE_URL=mysql://USER:PASSWORD@127.0.0.1:3306/DATABASE` using the MySQL port in use. URL-encode credentials. Set a stable `SESSION_SECRET` of at least 32 characters. Generate a value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. Verify the connection points to the intended local database, then run `npm run db:migrate`.
4. Run `npm run dev`. The API starts first, probes MySQL and the current schema, and then starts Vite. Open `http://127.0.0.1:5173`. If a port is occupied, stop the other development terminal or set `PORT` and `NANTI_DEV_WEB_PORT`.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL connection. Required. |
| `SESSION_SECRET` | Stable secret for guest cookies and private assessment fingerprints. Required. |
| `HOST`, `PORT` | API listener. Defaults to `127.0.0.1:3000`. |
| `NANTI_DEV_WEB_PORT` | Vite port for `npm run dev`. Defaults to `5173`. |
| `NODE_ENV`, `NANTI_TRUST_PROXY` | Public environment mode and optional trusted reverse proxy IP. |
| `NANTI_IKEA_METADATA_PERMISSION` | Leave blank for manual entry. Set `granted` only with explicit permission covering automated retrieval and reuse of titles and photos from the supported `www.ikea.com` listings. |
| `NANTI_IKEA_PRICE_METADATA_PERMISSION` | Set `granted` only when that permission also covers price and currency. The title and photo permission must also be enabled. Imported prices are unverified and the wishlist currency must match. |
| `NANTI_SHOPEE_PRICE_METADATA_PERMISSION` | Leave blank unless automated retrieval and reuse of Shopee's published, exact single-offer price is authorized. Set `granted` only after confirming that permission. Shopee prices remain manual by default; variant, range, conflicting, and unsupported values are withheld. |
| `AUTH_PUBLIC_ORIGIN`, `AUTH_GOOGLE_*`, `AUTH_APPLE_*` | Optional consumer OAuth. See [authentication setup](AUTHENTICATION.md). |
| `NANTI_ADMIN_USERNAME`, `NANTI_ADMIN_PASSWORD_HASH` | Optional separate affiliate administration. See [Affiliate Center setup](AFFILIATE_CENTER.md). |
| `TEST_DATABASE_URL` | Disposable migrated MySQL schema for tests. |

The API readiness endpoint is `GET /api/health`. For split terminals, use `npm run dev:api` and `npm run dev:web`. If Vite serves the page but the API is down, the proxy returns a structured connection error. If the API reports the database is unavailable, check the MySQL process, the connection settings, and migration status. `npm start` serves the built app and API together after `npm run build`.

For a loopback MySQL instance that uses `caching_sha2_password` without TLS, point the connector to the server's known RSA public key. Append `?cachingRsaPublicKey=<URL-encoded absolute path to public_key.pem>` to `DATABASE_URL`, or use `&` if it already has query parameters. This permits a fresh login after MySQL clears its authentication cache. For remote connections, use TLS with server certificate verification. [MariaDB Connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## Product links and price sources

| Retailer | Link intake | Automatic price checks |
| --- | --- | --- |
| Shopee | Detects supported storefronts and share links. Uses matching public product metadata when available; otherwise enter details manually. | Exact structured single-offer price only when `NANTI_SHOPEE_PRICE_METADATA_PERMISSION=granted`; no automatic monitoring. |

### Historical catalog reconciliation

Run `node --env-file=.env.test.local --import tsx scripts/reconcile-catalog-metadata.ts --limit 50` against local `nanti_dev`. Continue with the summary's `next` value as `--after`. The default dry run reports marketplace classification changes, candidate identity collisions, missing public metadata, and provenance mismatches. The report contains catalog IDs and counts.

Add `--refresh` to check supported public listing sources for recoverable titles and resolved destinations. IKEA refresh requires its existing metadata permission. An approved `--refresh --apply` run can fill missing catalog titles when the verified lookup key is unchanged. Identity merges and historical image and price repair require separate review. Production reconciliation requires explicit approval.
| Tokopedia | Detects the storefront and share links. Review the original link and enter details manually. | Unavailable |
| IKEA | Recognizes `ikea.com` and `ikea.co.id`. With permission, selected `www.ikea.com` product pages can supply a title and photo. Users review and save details themselves. | Unavailable |
| Other stores | Keeps a valid public listing link and supports manual entry. | Unavailable |

Public links are validated before use. The application never resolves arbitrary store URLs or short-link redirects on the server. The permission-gated IKEA lookup uses a fixed HTTPS origin, bounds time and response size, and declines redirects. Marketplace seller authorizations and catalog rights have not been provisioned for Nanti. [Shopee Open Platform](https://open.shopee.com/) · [TikTok Shop seller authorization](https://partner.tiktokshop.com/docv2/page/common-parameters) · [IKEA website terms](https://www.ikea.com/us/en/customer-service/terms-conditions/)

Price tracking is private to each saved item and uses the wishlist’s currency. Use **Record a price** after checking the original listing. The current saved unit price and the observation are updated in one transaction. An unchanged price creates no duplicate. History shows the exact amount, date, and source, and the chart starts after two observations. Existing prices are labeled as migration snapshots. Manual prices and values copied from a listing are labeled separately. A verified-check timestamp appears only when a verified observation exists. Record separate wishlist items for variants you want to track separately.

Targets evaluate when a new price is recorded. A first qualifying price or a new crossing from above records the reached time and can create one in-app alert. The per-product toggle mutes notifications while keeping the reached time. Previously issued alerts are visible in the inbox until the tracked item or its owning account is deleted. There is no email, push, or background marketplace polling.

## Upgrade and release checklist

1. Take a restorable MySQL backup. Apply the migrations on an isolated copy using `npm run db:migrate`. Phase 4 is `20261118050000_price_tracking`, after `20261118040000_consumer_accounts`.
2. Compare existing item, account, assessment, and affiliate rows before and after. Verify one legacy observation per previously priced item and zero migration-generated alerts. The observation date is when tracking was enabled, so it does not imply a historical marketplace check.
3. Pause writers for the migration and deploy the matching application build afterwards. Use separate MySQL deployment and runtime credentials. Give the runtime account only required data access and use TLS for remote connections.
4. Run `npm run typecheck`, `npm test` with an isolated `TEST_DATABASE_URL`, and `npm run build`. Run the core, affiliate, accounts, visual, and MVP browser suites. Check the public HTTPS origin, existing signed guest access, administrator isolation, original links, and both OAuth providers if enabled.
5. Keep a backup of the Phase 4 schema and data before any recovery. MySQL DDL can apply partially. Inspect `_prisma_migrations` and the actual schema on an isolated copy before repairing or retrying. Preserve the new tables after users begin recording prices. A preceding application version can write item prices without recording observations, so use a maintenance window or a forward fix rather than letting old writers create gaps.
