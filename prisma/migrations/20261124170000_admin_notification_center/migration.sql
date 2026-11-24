ALTER TABLE `AdminNotification`
  MODIFY `identityId` CHAR(36) NULL,
  ADD COLUMN `subject` VARCHAR(160) NULL,
  ADD COLUMN `targetPath` VARCHAR(255) NULL,
  ADD INDEX `AdminNotification_dismissedAt_readAt_createdAt_idx` (`dismissedAt`, `readAt`, `createdAt`);
