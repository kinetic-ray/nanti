-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `displayName` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataOwner` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,

    INDEX `DataOwner_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthIdentity` (
    `provider` ENUM('google', 'apple') NOT NULL,
    `subjectHash` CHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,

    UNIQUE INDEX `AuthIdentity_userId_provider_key`(`userId`, `provider`),
    PRIMARY KEY (`provider`, `subjectHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSession` (
    `tokenHash` CHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `pendingGuestOwnerId` CHAR(36) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NOT NULL,

    INDEX `UserSession_userId_idx`(`userId`),
    INDEX `UserSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthAttempt` (
    `stateHash` CHAR(64) NOT NULL,
    `browserHash` CHAR(64) NOT NULL,
    `provider` ENUM('google', 'apple') NOT NULL,
    `purpose` ENUM('signin', 'link', 'verify') NOT NULL,
    `nonce` VARCHAR(64) NOT NULL,
    `verifier` VARCHAR(128) NULL,
    `guestOwnerId` CHAR(36) NULL,
    `sessionHash` CHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `OAuthAttempt_sessionHash_idx`(`sessionHash`),
    INDEX `OAuthAttempt_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`stateHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve ownership of all pre-3A wishlists and standalone preferences.
INSERT INTO `DataOwner` (`id`)
SELECT `ownerId` FROM `Wishlist`
UNION
SELECT `ownerId` FROM `IntelligencePreference`;

-- AddForeignKey
ALTER TABLE `Wishlist` ADD CONSTRAINT `Wishlist_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `DataOwner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntelligencePreference` ADD CONSTRAINT `IntelligencePreference_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `DataOwner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DataOwner` ADD CONSTRAINT `DataOwner_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthIdentity` ADD CONSTRAINT `AuthIdentity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSession` ADD CONSTRAINT `UserSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAttempt` ADD CONSTRAINT `OAuthAttempt_sessionHash_fkey` FOREIGN KEY (`sessionHash`) REFERENCES `UserSession`(`tokenHash`) ON DELETE CASCADE ON UPDATE CASCADE;
