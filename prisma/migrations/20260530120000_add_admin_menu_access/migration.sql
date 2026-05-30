-- Add per-admin menu access configuration.
-- NULL or an empty array means the admin has full access to every menu.
ALTER TABLE `admins` ADD COLUMN `menuAccess` JSON NULL;
