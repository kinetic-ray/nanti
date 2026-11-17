-- CreateTable
CREATE TABLE `PriceObservation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ownerId` CHAR(36) NOT NULL,
    `wishlistId` CHAR(36) NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `priceMinor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `source` ENUM('existing', 'manual', 'imported_unverified', 'marketplace_verified') NOT NULL,
    `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PriceObservation_ownerId_wishlistId_itemId_id_idx`(`ownerId`, `wishlistId`, `itemId`, `id`),
    INDEX `PriceObservation_itemId_source_id_idx`(`itemId`, `source`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PriceTarget` (
    `itemId` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `wishlistId` CHAR(36) NOT NULL,
    `priceMinor` INTEGER NOT NULL,
    `notify` BOOLEAN NOT NULL DEFAULT true,
    `lastReachedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PriceTarget_ownerId_wishlistId_itemId_key`(`ownerId`, `wishlistId`, `itemId`),
    PRIMARY KEY (`itemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PriceAlert` (
    `id` CHAR(36) NOT NULL,
    `observationId` BIGINT UNSIGNED NOT NULL,
    `targetMinor` INTEGER NOT NULL,
    `readAt` DATETIME(3) NULL,

    UNIQUE INDEX `PriceAlert_observationId_key`(`observationId`),
    INDEX `PriceAlert_readAt_observationId_idx`(`readAt`, `observationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PriceObservation` ADD CONSTRAINT `PriceObservation_ownerId_wishlistId_itemId_fkey` FOREIGN KEY (`ownerId`, `wishlistId`, `itemId`) REFERENCES `Item`(`ownerId`, `wishlistId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceTarget` ADD CONSTRAINT `PriceTarget_ownerId_wishlistId_itemId_fkey` FOREIGN KEY (`ownerId`, `wishlistId`, `itemId`) REFERENCES `Item`(`ownerId`, `wishlistId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceAlert` ADD CONSTRAINT `PriceAlert_observationId_fkey` FOREIGN KEY (`observationId`) REFERENCES `PriceObservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Capture existing prices with the migration time and explicit legacy provenance.
INSERT INTO `PriceObservation` (`ownerId`, `wishlistId`, `itemId`, `priceMinor`, `currency`, `source`)
SELECT i.`ownerId`, i.`wishlistId`, i.`id`, i.`priceMinor`, w.`currency`, 'existing'
FROM `Item` i
JOIN `Wishlist` w ON w.`id` = i.`wishlistId` AND w.`ownerId` = i.`ownerId`
WHERE i.`priceMinor` BETWEEN 0 AND 999999999;
