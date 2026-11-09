-- Extend billing_history.eventType enum with trial reminder events.
-- Used by SubscriptionExpiryService.handleTrialReminders to track
-- which trial-end reminders have already been sent so we don't spam.

ALTER TABLE `billing_history`
  MODIFY COLUMN `eventType` ENUM(
    'created',
    'renewed',
    'upgraded',
    'downgraded',
    'cycle_changed',
    'cancelled',
    'reactivated',
    'expired',
    'trial_reminder_sent'
  ) NOT NULL;
