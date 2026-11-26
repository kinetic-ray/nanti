CREATE TABLE `FinancialProfile` (
  `userId` CHAR(36) NOT NULL,
  `income` JSON NULL,
  `expenses` JSON NULL,
  `debts` JSON NULL,
  `savings` JSON NULL,
  `readiness` JSON NULL,
  `additional` JSON NULL,
  `incomeUpdatedAt` DATETIME(3) NULL,
  `expensesUpdatedAt` DATETIME(3) NULL,
  `debtsUpdatedAt` DATETIME(3) NULL,
  `savingsUpdatedAt` DATETIME(3) NULL,
  `readinessUpdatedAt` DATETIME(3) NULL,
  `additionalUpdatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `FinancialProfile_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
