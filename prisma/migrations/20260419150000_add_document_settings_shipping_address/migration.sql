-- Add shipping (ship-to) address to document_settings.
-- Lets admins configure a default delivery address per property, so when
-- creating a Purchase Order they can pick between the billing address
-- (DocumentSettings.address) and the dedicated shipping address instead
-- of retyping it every time.

ALTER TABLE `document_settings`
  ADD COLUMN `shippingAddress`   TEXT NULL,
  ADD COLUMN `shippingAddressEn` TEXT NULL;
