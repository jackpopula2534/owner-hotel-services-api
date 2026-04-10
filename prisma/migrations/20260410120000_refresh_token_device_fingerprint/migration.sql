-- Migration: Add device fingerprint fields to refresh_tokens
-- Allows users to see active sessions and revoke individual devices
-- All columns are nullable for backward compatibility with existing tokens

ALTER TABLE `refresh_tokens`
  ADD COLUMN `deviceName`  VARCHAR(255) NULL COMMENT 'Human-readable device name e.g. "iPhone 14 - Safari"',
  ADD COLUMN `deviceType`  VARCHAR(50)  NULL COMMENT 'desktop | mobile | tablet | unknown',
  ADD COLUMN `ipAddress`   VARCHAR(45)  NULL COMMENT 'IPv4 or IPv6 address at login time',
  ADD COLUMN `userAgent`   TEXT         NULL COMMENT 'Full User-Agent string',
  ADD COLUMN `lastUsedAt`  DATETIME     NULL COMMENT 'Last time this refresh token was used to get a new access token',
  ADD COLUMN `lastUsedIp`  VARCHAR(45)  NULL COMMENT 'IP address at last token refresh';

-- Index for session management queries (list active sessions per user)
CREATE INDEX `idx_refresh_tokens_userId_lastUsedAt`
  ON `refresh_tokens` (`userId`, `lastUsedAt`);
