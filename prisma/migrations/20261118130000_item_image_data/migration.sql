-- Product images are stored as bounded, client-compressed data URIs.
-- No external storage credentials are required.
ALTER TABLE `Item` ADD COLUMN `imageData` MEDIUMTEXT NULL;
