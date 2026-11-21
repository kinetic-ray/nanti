CREATE TABLE `CreatorPage` (
  `profileId` CHAR(36) NOT NULL,
  `design` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`profileId`),
  CONSTRAINT `CreatorPage_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `CreatorProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
