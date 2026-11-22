-- Additive only. Do not apply to production before full integration and review.
CREATE TABLE `CuratedRecommendation` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `category` VARCHAR(80) NOT NULL,
  `color` VARCHAR(80) NULL,
  `style` VARCHAR(80) NULL,
  `useCase` VARCHAR(80) NULL,
  `description` VARCHAR(1000) NULL,
  `priceMinor` INTEGER NULL,
  `currency` CHAR(3) NOT NULL,
  `priceVerified` BOOLEAN NOT NULL DEFAULT false,
  `priceVerifiedAt` DATETIME(3) NULL,
  `published` BOOLEAN NOT NULL DEFAULT false,
  `priority` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `CuratedRecommendation_published_category_currency_idx` (`published`, `category`, `currency`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RecommendationRequest` (
  `id` CHAR(36) NOT NULL,
  `ownerId` CHAR(36) NOT NULL,
  `productKey` CHAR(64) NOT NULL,
  `productName` VARCHAR(160) NOT NULL,
  `sourceCategory` VARCHAR(80) NULL,
  `sourcePriceMinor` INTEGER NULL,
  `sourceCurrency` CHAR(3) NULL,
  `sourceColor` VARCHAR(80) NULL,
  `status` ENUM('pending', 'fulfilled') NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `fulfilledAt` DATETIME(3) NULL,
  UNIQUE INDEX `RecommendationRequest_ownerId_productKey_key` (`ownerId`, `productKey`),
  INDEX `RecommendationRequest_status_productKey_idx` (`status`, `productKey`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RecommendationNotice` (
  `id` CHAR(36) NOT NULL,
  `requestId` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `readAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `RecommendationNotice_requestId_productId_key` (`requestId`, `productId`),
  INDEX `RecommendationNotice_requestId_readAt_createdAt_idx` (`requestId`, `readAt`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RecommendationNotice`
  ADD CONSTRAINT `RecommendationNotice_requestId_fkey`
  FOREIGN KEY (`requestId`) REFERENCES `RecommendationRequest`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
