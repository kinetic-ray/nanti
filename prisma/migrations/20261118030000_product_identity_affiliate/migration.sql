-- AlterTable
ALTER TABLE `Item` ADD COLUMN `productIdentityId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `ProductIdentity` (
    `id` CHAR(36) NOT NULL,
    `lookupKey` CHAR(64) NOT NULL,
    `merchant` VARCHAR(64) NOT NULL,
    `market` VARCHAR(16) NOT NULL,
    `listingId` VARCHAR(80) NOT NULL,
    `canonicalUrl` VARCHAR(2048) NOT NULL,
    `title` VARCHAR(160) NULL,
    `normalizedTitle` VARCHAR(220) NULL,
    `brand` VARCHAR(120) NULL,
    `model` VARCHAR(120) NULL,
    `sellerId` VARCHAR(120) NULL,
    `variants` JSON NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductIdentity_lookupKey_key`(`lookupKey`),
    INDEX `ProductIdentity_createdAt_id_idx`(`createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateMapping` (
    `id` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `activeIdentityId` CHAR(36) NULL,
    `originalUrl` VARCHAR(2048) NOT NULL,
    `affiliateUrl` VARCHAR(2048) NOT NULL,
    `candidateKey` CHAR(64) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'disabled', 'revoked', 'invalid') NOT NULL DEFAULT 'pending',
    `classification` ENUM('verified_exact', 'potential', 'mismatch', 'insufficient') NOT NULL,
    `evidence` JSON NULL,
    `approvedBy` VARCHAR(64) NULL,
    `approvedAt` DATETIME(3) NULL,
    `validatedAt` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AffiliateMapping_activeIdentityId_key`(`activeIdentityId`),
    INDEX `AffiliateMapping_identityId_createdAt_id_idx`(`identityId`, `createdAt`, `id`),
    UNIQUE INDEX `AffiliateMapping_identityId_candidateKey_key`(`identityId`, `candidateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateAudit` (
    `id` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `mappingId` CHAR(36) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `details` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AffiliateAudit_identityId_createdAt_id_idx`(`identityId`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminNotification` (
    `id` CHAR(36) NOT NULL,
    `eventKey` VARCHAR(120) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `dismissedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AdminNotification_eventKey_key`(`eventKey`),
    INDEX `AdminNotification_dismissedAt_createdAt_id_idx`(`dismissedAt`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminSession` (
    `tokenHash` CHAR(64) NOT NULL,
    `credentialScope` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `AdminSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Item_productIdentityId_idx` ON `Item`(`productIdentityId`);

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_productIdentityId_fkey` FOREIGN KEY (`productIdentityId`) REFERENCES `ProductIdentity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateMapping` ADD CONSTRAINT `AffiliateMapping_identityId_fkey` FOREIGN KEY (`identityId`) REFERENCES `ProductIdentity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateMapping` ADD CONSTRAINT `AffiliateMapping_activeIdentityId_fkey` FOREIGN KEY (`activeIdentityId`) REFERENCES `ProductIdentity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateAudit` ADD CONSTRAINT `AffiliateAudit_identityId_fkey` FOREIGN KEY (`identityId`) REFERENCES `ProductIdentity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateAudit` ADD CONSTRAINT `AffiliateAudit_mappingId_fkey` FOREIGN KEY (`mappingId`) REFERENCES `AffiliateMapping`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminNotification` ADD CONSTRAINT `AdminNotification_identityId_fkey` FOREIGN KEY (`identityId`) REFERENCES `ProductIdentity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
