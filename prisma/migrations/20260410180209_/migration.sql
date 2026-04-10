-- AlterTable
ALTER TABLE `refresh_tokens` MODIFY `lastUsedAt` DATETIME(3) NULL;

-- RenameIndex
ALTER TABLE `refresh_tokens` RENAME INDEX `idx_refresh_tokens_userId_lastUsedAt` TO `refresh_tokens_userId_lastUsedAt_idx`;

-- RenameIndex
ALTER TABLE `refresh_tokens` RENAME INDEX `idx_refresh_tokens_userId_systemContext` TO `refresh_tokens_userId_systemContext_idx`;
