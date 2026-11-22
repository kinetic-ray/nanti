ALTER TABLE `AccountToken`
  MODIFY `kind` ENUM('verify', 'reset', 'changeEmail') NOT NULL,
  ADD COLUMN `pendingEmail` VARCHAR(254) NULL;
