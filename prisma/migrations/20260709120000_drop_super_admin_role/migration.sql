-- Retire the `super_admin` role.
--
-- Nothing in the codebase ever assigned it: `admins.role` defaults to
-- 'platform_admin' and the seeder writes 'platform_admin' everywhere. But both
-- `admins.role` and `users.role` are free-form VARCHARs, so a hand-edited row
-- may still carry it. Once the role is gone from ROLE_LEVELS, getRoleLevel()
-- returns 0 for it and every @Roles endpoint would 403 that account.
--
-- Normalise the data before the code stops recognising the value.

-- admins.role: super_admin was platform-level (ADMIN_ONLY_ROLES + addon.guard
-- bypass), and every admins row authenticates as isPlatformAdmin anyway.
UPDATE `admins` SET `role` = 'platform_admin' WHERE `role` = 'super_admin';

-- users.role: such a row could never sign in — ADMIN_ONLY_ROLES rejected it at
-- /auth/login. Map it to 'admin', which is still in ADMIN_ONLY_ROLES, so the
-- account stays locked out exactly as before rather than silently gaining a
-- level-0 login once 'super_admin' is no longer blocked by name.
UPDATE `users` SET `role` = 'admin' WHERE `role` = 'super_admin';
