-- Migration: Add allowedSystems to users + systemContext to refresh_tokens
-- Purpose: Isolate POS sessions from the main hotel management dashboard
--          so a POS logout does NOT log out the main system (and vice versa).

-- 1. users: allowedSystems controls which system(s) a user may log into
--    Default = '["main"]' so existing hotel-owner accounts are unaffected.
--    POS-only staff (waiter, chef, cashier) will be set to '["pos"]'.
--    Managers who need both systems get '["main","pos"]'.
ALTER TABLE `users`
  ADD COLUMN `allowedSystems` VARCHAR(255) NOT NULL DEFAULT '["main"]';

-- 2. refresh_tokens: systemContext tags every token with the system that issued it
--    Values: 'main' | 'pos'
--    Logout from POS only revokes tokens where systemContext = 'pos'.
ALTER TABLE `refresh_tokens`
  ADD COLUMN `systemContext` VARCHAR(20) NOT NULL DEFAULT 'main';

-- 3. Index to make per-system token lookups fast
CREATE INDEX `idx_refresh_tokens_userId_systemContext`
  ON `refresh_tokens` (`userId`, `systemContext`);
