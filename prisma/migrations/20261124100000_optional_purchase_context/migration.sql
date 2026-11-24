ALTER TABLE `IntelligencePreference`
    MODIFY `coolingOffDays` INTEGER NULL,
    ADD COLUMN `financialContexts` JSON NULL;
