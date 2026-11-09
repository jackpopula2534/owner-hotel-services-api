-- Add multiple gallery images for individual camp pitches.
ALTER TABLE `camp_pitches`
  ADD COLUMN `images` JSON NULL;
