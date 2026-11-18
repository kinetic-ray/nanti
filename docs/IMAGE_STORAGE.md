# Product image storage (Issue #11)

This branch replaces the earlier TiDB Base64 image design with a portable S3-compatible private bucket. **The imageKey schema was merged into main before the production migration was verified. Do not assume the deployed application is healthy until the migration has been applied and /api/health returns ready.**

## Setup

Create a **private** Cloudflare R2 bucket (or an S3-compatible bucket on a server). Set `NANTI_S3_ENDPOINT` to its HTTPS S3 API endpoint, `NANTI_S3_BUCKET` to the bucket name, `NANTI_S3_REGION` to the region (R2 uses `auto`), and set `NANTI_S3_ACCESS_KEY_ID` and `NANTI_S3_SECRET_ACCESS_KEY` to credentials restricted to this bucket. Never put secrets in `VITE_*` variables or the frontend.

The bucket needs CORS for browser `PUT` from the actual Nanti web origin, allowing the `Content-Type` header. Do not use wildcard origins for production. `GET` is via short-lived signed URL, generated after wishlist ownership checks.

## Data flow

1. Browser compresses the selected image into JPEG, maximum 195 KB.
2. Authenticated/guest owner requests a five-minute presigned PUT URL from `POST /api/uploads/product-image`.
3. Browser PUTs JPEG directly to object storage; backend credentials are never sent to browser.
4. Saving a product supplies the object key. API verifies owner namespace and a bounded HEAD response before saving the key.
5. Wishlist JSON contains the key, not the image bytes. Private GET requests redirect to a two-minute presigned URL.

## Release gate

- Back up TiDB and verify that migration `20261118130000_item_image_data` has been applied. If not, run `npm run db:migrate` using the authorized production `DATABASE_URL` from a trusted environment; never paste credentials into issues or chat. First rehearse against an isolated copy. The `/api/health` readiness probe now selects `Item.imageKey` to detect a missing column even if no items exist.
- Test S3 signing with the actual provider and bucket CORS (R2 and self-hosted S3).
- Run `npm run typecheck`, `npm run build`, and browser smoke tests.
- Verify guest/account ownership, editing and removing images, Android gallery Back, and that images survive reload.
- Implement orphan cleanup for uploaded-but-unsaved images and replaced/deleted images before large-scale rollout.
- Monitor storage usage and costs. Product photos from marketplaces require appropriate reuse permissions.
