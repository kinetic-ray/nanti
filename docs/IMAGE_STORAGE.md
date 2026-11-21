# Product image storage (Issue #11)

This branch replaces the earlier TiDB Base64 image design with a portable S3-compatible private bucket. **The imageKey schema was merged into main before the production migration was verified. Do not assume the deployed application is healthy until the migration has been applied and /api/health returns ready.**

## Setup

Create a **private** Cloudflare R2 bucket. Configure `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in the backend environment. Use the account's HTTPS S3 endpoint and bucket-scoped object read/write credentials. The adapter uses the `auto` signing region. Leave `R2_PUBLIC_BASE_URL` blank for private images. A configured legacy `NANTI_S3_*` backend takes precedence so existing object references continue to use their original bucket.

## Data flow

1. The browser compresses a selected photo into JPEG and sends it to Nanti's authenticated same-origin endpoint. The server checks the JPEG structure, dimensions and 195 KB size limit before uploading.
2. Nanti stores the photo in a private owner-scoped object. The client receives only the object key.
3. When the product is saved, Nanti checks the key's owner and verifies the stored object before persisting the reference.
4. The wishlist photo endpoint checks ownership and serves bounded bytes using a server-side signed GET. R2 needs no browser CORS or public bucket URL for this flow.
5. Removing or replacing an item photo attempts to delete the old R2 object once no item references it.

For Tokopedia, **Save product** copies the previewed listing photo automatically when storage is configured and no image was selected manually. Nanti uses its existing DNS-pinned HTTPS fetch, validates the retailer JPEG, and stores only the object key. If copying fails, the product can still be saved without the photo.

## Release gate

- Back up TiDB and verify that migration `20261118130000_item_image_data` has been applied. If not, run `npm run db:migrate` using the authorized production `DATABASE_URL` from a trusted environment; never paste credentials into issues or chat. First rehearse against an isolated copy. The `/api/health` readiness probe now selects `Item.imageKey` to detect a missing column even if no items exist.
- Test S3 signing with the actual provider and bucket CORS (R2 and self-hosted S3).
- Run `npm run typecheck`, `npm run build`, and browser smoke tests.
- Verify guest/account ownership, editing and removing images, Android gallery Back, and that images survive reload.
- Implement orphan cleanup for uploaded-but-unsaved images and replaced/deleted images before large-scale rollout.
- Monitor storage usage and costs. Product photos from marketplaces require appropriate reuse permissions.
