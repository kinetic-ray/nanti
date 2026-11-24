ALTER TABLE `ProductImage` ADD COLUMN `marketplaceIdentityId` CHAR(36) NULL;
CREATE INDEX `ProductImage_marketplaceIdentityId_createdAt_idx` ON `ProductImage`(`marketplaceIdentityId`, `createdAt`);
ALTER TABLE `PriceObservation` ADD COLUMN `marketplaceIdentityId` CHAR(36) NULL;
CREATE INDEX `PriceObservation_marketplaceIdentityId_id_idx` ON `PriceObservation`(`marketplaceIdentityId`, `id`);
ALTER TABLE `AffiliateMapping` ADD COLUMN `directReplacement` BOOLEAN NOT NULL DEFAULT false;
