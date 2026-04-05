-- Fix max_properties for all plan codes (S, M, L, FREE, TRIAL)
-- Previous migration used wrong codes (basic/standard/premium/enterprise)
-- Correct codes in production are: FREE, TRIAL, S, M, L

-- Trial / Free plan: 2 properties
UPDATE `plans` SET `max_properties` = 2 WHERE `code` IN ('FREE', 'TRIAL');

-- Starter (S): 1 property
UPDATE `plans` SET `max_properties` = 1 WHERE `code` = 'S';

-- Professional (M): 3 properties
UPDATE `plans` SET `max_properties` = 3 WHERE `code` = 'M';

-- Enterprise (L): 5 properties (or 999 for unlimited)
UPDATE `plans` SET `max_properties` = 5 WHERE `code` = 'L';
