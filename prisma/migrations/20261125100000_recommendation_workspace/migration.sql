ALTER TABLE `CuratedRecommendation`
  ADD COLUMN `productIdentityId` CHAR(36) NULL,
  ADD COLUMN `listingUrl` VARCHAR(2048) NULL,
  ADD COLUMN `importedTitle` VARCHAR(160) NULL,
  ADD COLUMN `importedImage` VARCHAR(2048) NULL,
  ADD COLUMN `importedPriceAt` DATETIME(3) NULL,
  ADD COLUMN `archivedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `CuratedRecommendation_productIdentityId_key`
  ON `CuratedRecommendation`(`productIdentityId`);
ALTER TABLE `CuratedRecommendation` ADD CONSTRAINT `CuratedRecommendation_productIdentityId_fkey`
  FOREIGN KEY (`productIdentityId`) REFERENCES `ProductIdentity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
