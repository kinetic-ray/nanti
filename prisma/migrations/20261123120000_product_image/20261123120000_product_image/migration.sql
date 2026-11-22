CREATE TABLE `ProductImage` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `itemId` CHAR(36) NULL,
    `mimeType` VARCHAR(32) NOT NULL,
    `size` INTEGER UNSIGNED NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `bytes` MEDIUMBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ProductImage_itemId_key`(`itemId`),
    INDEX `ProductImage_itemId_createdAt_idx`(`itemId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ProductImage_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
