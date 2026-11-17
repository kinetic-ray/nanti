-- AlterTable
ALTER TABLE `Assessment` ADD COLUMN `financial` JSON NULL,
    ADD COLUMN `requestHash` CHAR(64) NULL,
    ADD COLUMN `requestKey` CHAR(36) NULL,
    ADD COLUMN `snapshot` JSON NULL,
    MODIFY `kind` ENUM('impulse', 'comparison', 'timing') NOT NULL;

-- AlterTable
ALTER TABLE `IntelligencePreference` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateIndex
CREATE INDEX `Assessment_createdAt_idx` ON `Assessment`(`createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `Assessment_ownerId_requestKey_key` ON `Assessment`(`ownerId`, `requestKey`);

-- CreateIndex
CREATE INDEX `IntelligencePreference_updatedAt_idx` ON `IntelligencePreference`(`updatedAt`);
