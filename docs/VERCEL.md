# Deploy Nanti to Vercel

Use the repository root as the Vercel Root Directory. Select the **Vite** framework preset and **Node.js 26.x**. Vercel currently resolves the repository's `>=22.12` Node range to 26.x. The repository's configuration installs with `npm ci --include=dev`, runs `npm run build`, and publishes `dist/web`. The install step generates the Prisma client only. Fluid compute is enabled, and `api/index.ts` is a single Node.js function with a 60-second limit. Choose a Function Region near the TiDB cluster and verify that the cluster accepts connections from that deployment.

The browser and API share one HTTPS origin. Vercel serves the built React application, including direct visits to `/account` and `/admin`. Paths under `/api` are handled by Express. Vite assets stay on the static route.

## Production environment variables

Set these in the Vercel **Production** environment. Keep credentials server-side and do not prefix them with `VITE_`. The upload ignore file excludes local environment files and generated build artifacts.

| Variable | When to set it | Value |
| --- | --- | --- |
| `DATABASE_URL` | Required | TiDB's MySQL URL in the form `mysql://USER:PASSWORD@HOST:4000/DATABASE?sslaccept=strict`. Use the actual DNS hostname and port from TiDB and percent-encode the username, password, and schema if needed. The runtime enforces TLS and certificate and hostname verification. |
| `SESSION_SECRET` | Required | A stable random secret of at least 32 characters. Keep the existing value when moving the same production app to Vercel, since it signs guest cookies and protects assessment fingerprints and admin session scope. |
| `CRON_SECRET` | Required for scheduled retention | A separate random secret, at least 16 characters using letters, digits, hyphens, or underscores. Vercel sends it to the retention endpoint in the bearer header. The daily job invokes the existing expiry cleanup at 03:00 UTC. |
| `DATABASE_CA_CERT_BASE64` | Optional, for a cluster using a CA outside Node's bundled trust store | Base64 of the trusted PEM CA certificate or bundle. Vercel does not use any local file path from a Prisma CLI connection string. Public TiDB Cloud Starter and Essential endpoints use a publicly trusted CA. |
| `DATABASE_POOL_LIMIT` | Optional | Connections per warm function instance. Default `3`, allowed values `2` through `10`. Idle connections retire after about five seconds. The total across scaled instances is higher than the per-instance cap. |
| `AUTH_PUBLIC_ORIGIN` | Required if Google or Apple or account email is enabled | Set the production origin exactly to `https://nanti-liart.vercel.app`, with no path. Account verification, resend verification, and password reset links fail closed if the production origin is missing or differs. Start OAuth from this hostname so the browser can send the host-scoped attempt cookie on return. |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | Optional as a pair | Register the exact HTTPS callback `/api/account/google/callback` on the canonical origin. Google returns by GET. |
| `AUTH_APPLE_CLIENT_ID`, `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`, `AUTH_APPLE_PRIVATE_KEY_BASE64` | Optional as a complete group | Register the exact HTTPS callback `/api/account/apple/callback` on the canonical origin. Apple returns by form POST. Encode the full PKCS#8 `.p8` key as base64. |
| `NANTI_ADMIN_USERNAME`, `NANTI_ADMIN_PASSWORD_HASH` | Optional as a pair | Existing Affiliate Center credentials. Use the stored `scrypt-v1` hash for the password, with the administrator UI at `/admin`. |
| `NANTI_IKEA_METADATA_PERMISSION`, `NANTI_IKEA_PRICE_METADATA_PERMISSION`, `NANTI_SHOPEE_PRICE_METADATA_PERMISSION` | Optional | Set each to `granted` only for the corresponding authorized metadata. Shopee price lookup is disabled unless explicitly enabled. |

Leave the standalone `HOST`, `PORT`, and `NANTI_TRUST_PROXY` settings unset on Vercel. The function trusts its single Vercel proxy hop for request IPs. Express keeps the per-instance request limits and secure host-scoped cookies. API mutations require JSON and the app's custom request header. Apple's callback uses the existing browser-bound, one-use OAuth state check and its cross-site attempt cookie.

Keep production database and login credentials scoped to Production. A Preview that needs data access or provider sign-in needs its own database credentials, secret, and registered callback origin. Moving to a new hostname requires a new browser cookie. Signed-in users can reopen their account data with a connected provider.

## Verify after a separately authorized deployment

Open `/api/health` on the canonical HTTPS origin to check TiDB access and schema readiness. Open `/`, `/account`, and `/admin` directly, then exercise guest access and each configured provider on that same domain. Check the protected scheduled cleanup in Vercel's cron logs. This verification assumes the existing application migrations are already applied.

[Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) · [Vercel connection pooling](https://vercel.com/kb/guide/connection-pooling-with-functions) · [TiDB Cloud TLS](https://docs.pingcap.com/tidbcloud/secure-connections-to-serverless-clusters/) · [Consumer authentication](AUTHENTICATION.md)
