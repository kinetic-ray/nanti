# Product image storage

Nanti stores new wishlist photos as JPEGs in MySQL. The `ProductImage` table holds a random image ID, MIME type, size, SHA-256 checksum, timestamps, and `MEDIUMBLOB` bytes. Wishlist responses still return `Item.imageKey`. Ordinary item reads select no image bytes.

## Local setup

1. Use a local MySQL database and set `DATABASE_URL` in your shell or local `.env`. Keep the same `SESSION_SECRET` across restarts so the browser can reopen its wishlist.
2. Run `npm ci`, `npm run db:migrate`, and `npm run dev`. Migration `20261123120000_product_image` adds the image table. `/api/health` checks that the table is available.
3. Paste a Shopee or Tokopedia product URL, preview it, then select **Save product**. Refresh the wishlist and restart the API to check that the photo still loads. Repeat with a manually selected photo to check that it takes priority.
4. Set `TEST_DATABASE_URL` to a disposable, migrated MySQL database and run `npm test -- tests/mysql-product-images.test.ts tests/wishlist.test.ts tests/tokopedia-image.test.ts tests/tokopedia-metadata.test.ts tests/image-storage.test.ts`.

## Save and serve

- On save, Nanti resolves the listing again and uses the image URL from server-side metadata. The downloader uses the existing DNS-pinned HTTPS transport, marketplace-specific host allowlists, a four-second deadline, a 195,000-byte input ceiling, and rejects all image redirects. Only JPEG, PNG, and WebP are admitted to raster validation. The server checks the bytes and dimensions, decodes the image, and re-encodes it as a metadata-free JPEG. Output aims for 100–195 KB where the photo needs it, with a hard ceiling of 195,000 bytes. Small photos can be smaller.
- The item, imported photo, and initial price observation share a transaction. If metadata, download, validation, or the image write fails, the item can still be saved and the UI reports that the store photo was unavailable. Manual uploads are staged as private standalone rows and attached once in the item transaction. A failed attachment keeps the existing photo and leaves the staged upload available for retry.
- `GET /api/wishlists/:listId/items/:itemId/uploaded-image` checks wishlist access and then matches both the MySQL image ID and the item ID. It serves JPEG with `private, no-store` and `nosniff`. Photo replacements remove the old MySQL row in the same transaction. Item, wishlist, and owner deletions cascade to attached photos.
- Retention cleanup deletes unattached uploads older than 24 hours. It runs on standalone startup and daily while the API runs, or through the existing retention cron on Vercel when configured.

## Legacy reads and remaining risks

Existing S3-compatible keys keep using the original private bucket. Keep complete `NANTI_S3_*` or `R2_*` settings if that bucket contains referenced photos. The legacy S3 configuration takes precedence when both are present. The runtime only reads legacy objects. There is no bucket backfill or object deletion in the migration.

Retailers may omit metadata, block automated requests, redirect images, or serve files above the download limit. Users can add their own photo in those cases. Monitor database growth, backup size, and the time it takes to restore image data. Keep retention cleanup enabled on serverless installations and verify the native image dependency on the intended host before rollout. Verify legacy reads against the actual bucket with authorized credentials before retiring it.
