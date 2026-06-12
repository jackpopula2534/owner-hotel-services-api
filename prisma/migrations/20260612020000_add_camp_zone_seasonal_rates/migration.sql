-- Camp Phase 3: seasonal/festival pricing per zone

ALTER TABLE `camp_zones` ADD COLUMN `seasonalRates` JSON NULL;
