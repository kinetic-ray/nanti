ALTER TABLE `CreatorProfile` ADD COLUMN `handle` VARCHAR(36) NULL, ADD COLUMN `publishedDesign` JSON NULL;
UPDATE `CreatorProfile` SET `handle` = UUID();
ALTER TABLE `CreatorProfile` MODIFY `handle` VARCHAR(36) NOT NULL;
CREATE UNIQUE INDEX `CreatorProfile_handle_key` ON `CreatorProfile`(`handle`);

CREATE TABLE `CreatorProduct` (
  `id` CHAR(36) NOT NULL,
  `profileId` CHAR(36) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `description` VARCHAR(1000) NOT NULL,
  `category` VARCHAR(60) NOT NULL,
  `priceMinor` INTEGER NULL,
  `currency` VARCHAR(3) NULL,
  `photo` MEDIUMBLOB NULL,
  `hasPhoto` BOOLEAN NOT NULL DEFAULT false,
  `published` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `CreatorProduct_profileId_published_createdAt_idx` (`profileId`, `published`, `createdAt`),
  CONSTRAINT `CreatorProduct_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `CreatorProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
