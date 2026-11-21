ALTER TABLE `AuthIdentity` ADD COLUMN `verifiedEmail` VARCHAR(254) NULL;
ALTER TABLE `OAuthAttempt` MODIFY `destination` ENUM('account','admin','creator') NULL;

CREATE TABLE `PasswordCredential` (
  `userId` CHAR(36) NOT NULL,
  `email` VARCHAR(254) NOT NULL,
  `passwordHash` VARCHAR(120) NOT NULL,
  `verifiedAt` DATETIME(3) NULL,
  PRIMARY KEY (`userId`),
  UNIQUE INDEX `PasswordCredential_email_key` (`email`),
  CONSTRAINT `PasswordCredential_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountToken` (
  `userId` CHAR(36) NOT NULL,
  `kind` ENUM('verify','reset') NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`, `kind`),
  UNIQUE INDEX `AccountToken_tokenHash_key` (`tokenHash`),
  INDEX `AccountToken_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `AccountToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CreatorOnboarding` (
  `userId` CHAR(36) NOT NULL,
  `continuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `CreatorOnboarding_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CreatorProfile` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CreatorProfile_userId_key` (`userId`),
  CONSTRAINT `CreatorProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
