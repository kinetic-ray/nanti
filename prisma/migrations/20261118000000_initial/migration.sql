-- CreateTable
CREATE TABLE `Wishlist` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Wishlist_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    UNIQUE INDEX `Wishlist_ownerId_id_key`(`ownerId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `wishlistId` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `url` VARCHAR(2048) NULL,
    `priceMinor` INTEGER NULL,
    `quantity` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Item_ownerId_wishlistId_createdAt_idx`(`ownerId`, `wishlistId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_ownerId_wishlistId_fkey` FOREIGN KEY (`ownerId`, `wishlistId`) REFERENCES `Wishlist`(`ownerId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
