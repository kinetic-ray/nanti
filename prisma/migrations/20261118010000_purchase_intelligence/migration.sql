-- CreateTable
CREATE TABLE `Assessment` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `wishlistId` CHAR(36) NOT NULL,
    `itemId` CHAR(36) NULL,
    `kind` ENUM('impulse', 'comparison') NOT NULL,
    `version` VARCHAR(24) NOT NULL,
    `input` JSON NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Assessment_ownerId_wishlistId_itemId_kind_createdAt_id_idx`(`ownerId`, `wishlistId`, `itemId`, `kind`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntelligencePreference` (
    `ownerId` CHAR(36) NOT NULL,
    `coolingOffDays` INTEGER NOT NULL,

    PRIMARY KEY (`ownerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Item_ownerId_wishlistId_id_key` ON `Item`(`ownerId`, `wishlistId`, `id`);

-- AddForeignKey
ALTER TABLE `Assessment` ADD CONSTRAINT `Assessment_ownerId_wishlistId_fkey` FOREIGN KEY (`ownerId`, `wishlistId`) REFERENCES `Wishlist`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assessment` ADD CONSTRAINT `Assessment_ownerId_wishlistId_itemId_fkey` FOREIGN KEY (`ownerId`, `wishlistId`, `itemId`) REFERENCES `Item`(`ownerId`, `wishlistId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
