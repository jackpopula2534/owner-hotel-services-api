-- Extend tenants.status enum with lifecycle states the platform needs:
--   past_due  — subscription invoice unpaid (in dunning)
--   cancelled — admin-cancelled or self-cancelled
--   archived  — soft-deleted, retained for compliance
--
-- Existing values (trial, active, suspended, expired) remain unchanged.

ALTER TABLE `tenants`
  MODIFY COLUMN `status` ENUM(
    'trial',
    'active',
    'past_due',
    'suspended',
    'expired',
    'cancelled',
    'archived'
  ) NOT NULL DEFAULT 'trial';
