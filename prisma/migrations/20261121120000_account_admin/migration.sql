ALTER TABLE `User` ADD COLUMN `role` ENUM('member', 'admin') NOT NULL DEFAULT 'member';
CREATE INDEX `User_createdAt_id_idx` ON `User`(`createdAt`, `id`);
ALTER TABLE `OAuthAttempt` ADD COLUMN `destination` ENUM('account', 'admin') NULL;

CREATE TABLE `AuthActivity` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NULL,
  `kind` ENUM('signed_in', 'signed_out') NOT NULL,
  `provider` ENUM('google', 'apple') NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AuthActivity_createdAt_id_idx` (`createdAt`, `id`),
  INDEX `AuthActivity_userId_idx` (`userId`),
  CONSTRAINT `AuthActivity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
