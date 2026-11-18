-- Store object-storage references, not binary image data in TiDB.
ALTER TABLE `Item` ADD COLUMN `imageKey` VARCHAR(255) NULL;
