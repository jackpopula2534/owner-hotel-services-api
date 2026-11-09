-- LEGAL-05: tamper-evidence for audit logs.
-- entry_hash is a SHA-256 of the row's immutable content, computed at write
-- time. A verification job recomputes it to detect after-the-fact edits.
-- Nullable so historical rows remain valid (they simply have no hash to verify).
ALTER TABLE `audit_logs` ADD COLUMN `entry_hash` VARCHAR(64) NULL;
