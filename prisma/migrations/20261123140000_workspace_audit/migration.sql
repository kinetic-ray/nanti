CREATE TABLE `WorkspaceAudit` (
    `id` CHAR(36) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `subject` VARCHAR(160) NOT NULL,
    `reason` VARCHAR(600) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WorkspaceAudit_createdAt_id_idx`(`createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
