/**
 * Initial schema migration — creates ALL TypeORM-managed tables.
 *
 * Timestamp 0000000000001 guarantees this migration is ALWAYS the first to run,
 * before any ALTER TABLE migrations (timestamps 1738xxxxxxxxx+).
 *
 * ⚠️  "plans" table is created here WITHOUT the columns added by the two
 *     subsequent migrations (1738301000000, 1738302000000).  Those migrations
 *     add their columns via ALTER TABLE and must run after this one.
 *
 * Table creation order respects MySQL FK constraints (parents before children):
 *   admins, plans, features, tenants
 *   → plan_features, subscriptions
 *   → invoices
 *   → invoice_adjustments, invoice_items, payments
 *   → payment_refunds, subscription_features
 *   → subscription_feature_logs, billing_history, tenant_credits
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema0000000000001 implements MigrationInterface {
  name = 'InitialSchema0000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. admins (no FKs) ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`admins\` (
        \`id\`          char(36)      NOT NULL,
        \`firstName\`   varchar(255)  NULL,
        \`lastName\`    varchar(255)  NULL,
        \`email\`       varchar(255)  NOT NULL,
        \`password\`    varchar(255)  NOT NULL,
        \`role\`        varchar(255)  NOT NULL DEFAULT 'platform_admin',
        \`status\`      varchar(255)  NOT NULL DEFAULT 'active',
        \`lastLoginAt\` datetime      NULL,
        \`lastLoginIp\` varchar(255)  NULL,
        \`createdAt\`   datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\`   datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_admins_email\` (\`email\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── 2. plans (base columns only — ALTER migrations add the rest) ──────
    await queryRunner.query(`
      CREATE TABLE \`plans\` (
        \`id\`            varchar(36)    NOT NULL,
        \`code\`          varchar(255)   NOT NULL,
        \`name\`          varchar(255)   NOT NULL,
        \`price_monthly\` decimal(10,2)  NOT NULL,
        \`max_rooms\`     int            NOT NULL,
        \`max_users\`     int            NOT NULL,
        \`is_active\`     tinyint        NOT NULL DEFAULT 1,
        UNIQUE INDEX \`IDX_plans_code\` (\`code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── 3. features (no FKs) ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`features\` (
        \`id\`            varchar(36)                       NOT NULL,
        \`code\`          varchar(255)                      NOT NULL,
        \`name\`          varchar(255)                      NOT NULL,
        \`description\`   text                              NULL,
        \`type\`          enum('toggle','limit','module')   NOT NULL,
        \`price_monthly\` decimal(10,2)                     NOT NULL DEFAULT '0.00',
        \`is_active\`     tinyint                           NOT NULL DEFAULT 1,
        UNIQUE INDEX \`IDX_features_code\` (\`code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── 4. tenants (no FKs) ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`tenants\` (
        \`id\`            varchar(36)                                    NOT NULL,
        \`name\`          varchar(255)                                   NOT NULL,
        \`room_count\`    int                                            NOT NULL DEFAULT 0,
        \`name_en\`       varchar(255)                                   NULL,
        \`property_type\` varchar(255)                                   NULL,
        \`location\`      varchar(255)                                   NULL,
        \`website\`       varchar(255)                                   NULL,
        \`description\`   text                                           NULL,
        \`customer_name\` varchar(255)                                   NULL,
        \`tax_id\`        varchar(255)                                   NULL,
        \`email\`         varchar(255)                                   NULL,
        \`phone\`         varchar(255)                                   NULL,
        \`address\`       text                                           NULL,
        \`district\`      varchar(255)                                   NULL,
        \`province\`      varchar(255)                                   NULL,
        \`postal_code\`   varchar(255)                                   NULL,
        \`status\`        enum('trial','active','suspended','expired')   NOT NULL DEFAULT 'trial',
        \`trial_ends_at\` timestamp                                      NULL,
        \`created_at\`    datetime(6)                                    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`    datetime(6)                                    NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── 5. plan_features (FK: plans, features) ────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`plan_features\` (
        \`id\`         varchar(36)   NOT NULL,
        \`plan_id\`    varchar(255)  NOT NULL,
        \`feature_id\` varchar(255)  NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`plan_features\` ADD CONSTRAINT \`FK_plan_features_plan\` FOREIGN KEY (\`plan_id\`) REFERENCES \`plans\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`plan_features\` ADD CONSTRAINT \`FK_plan_features_feature\` FOREIGN KEY (\`feature_id\`) REFERENCES \`features\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // ── 6. subscriptions (FK: tenants, plans) ────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`subscriptions\` (
        \`id\`                  varchar(36)                                          NOT NULL,
        \`subscription_code\`   varchar(255)                                         NULL,
        \`tenant_id\`           varchar(255)                                         NOT NULL,
        \`plan_id\`             varchar(255)                                         NOT NULL,
        \`previous_plan_id\`    varchar(255)                                         NULL,
        \`status\`              enum('trial','pending','active','expired','cancelled') NOT NULL DEFAULT 'trial',
        \`billing_cycle\`       enum('monthly','yearly')                             NOT NULL DEFAULT 'monthly',
        \`start_date\`          date                                                 NOT NULL,
        \`end_date\`            date                                                 NOT NULL,
        \`next_billing_date\`   date                                                 NULL,
        \`billing_anchor_date\` date                                                 NULL,
        \`auto_renew\`          tinyint                                              NOT NULL DEFAULT 1,
        \`cancelled_at\`        timestamp                                            NULL,
        \`cancellation_reason\` text                                                 NULL,
        \`renewed_count\`       int                                                  NOT NULL DEFAULT 0,
        \`last_renewed_at\`     timestamp                                            NULL,
        \`created_at\`          datetime(6)                                          NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`          datetime(6)                                          NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_subscriptions_code\` (\`subscription_code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_subscriptions_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_subscriptions_plan\` FOREIGN KEY (\`plan_id\`) REFERENCES \`plans\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_subscriptions_previous_plan\` FOREIGN KEY (\`previous_plan_id\`) REFERENCES \`plans\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // ── 7. invoices (FK: tenants, subscriptions) ──────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`invoices\` (
        \`id\`              varchar(36)                              NOT NULL,
        \`tenant_id\`       varchar(255)                             NOT NULL,
        \`subscription_id\` varchar(255)                             NULL,
        \`invoice_no\`      varchar(255)                             NOT NULL,
        \`amount\`          decimal(10,2)                            NOT NULL,
        \`original_amount\` decimal(10,2)                            NULL,
        \`adjusted_amount\` decimal(10,2)                            NULL,
        \`status\`          enum('pending','paid','rejected','voided') NOT NULL DEFAULT 'pending',
        \`due_date\`        date                                     NOT NULL,
        \`voided_at\`       timestamp                                NULL,
        \`voided_reason\`   text                                     NULL,
        \`notes\`           text                                     NULL,
        \`created_at\`      datetime(6)                              NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`      datetime(6)                              NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_invoices_invoice_no\` (\`invoice_no\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`invoices\` ADD CONSTRAINT \`FK_invoices_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`invoices\` ADD CONSTRAINT \`FK_invoices_subscription\` FOREIGN KEY (\`subscription_id\`) REFERENCES \`subscriptions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // ── 8. invoice_adjustments (FK: invoices) ─────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`invoice_adjustments\` (
        \`id\`                   varchar(36)                                                 NOT NULL,
        \`invoice_id\`           varchar(255)                                                NOT NULL,
        \`type\`                 enum('discount','credit','surcharge','proration','void','refund') NOT NULL,
        \`amount\`               decimal(10,2)                                               NOT NULL,
        \`original_amount\`      decimal(10,2)                                               NOT NULL,
        \`new_amount\`           decimal(10,2)                                               NOT NULL,
        \`reason\`               text                                                        NULL,
        \`notes\`                text                                                        NULL,
        \`adjustment_reference\` varchar(255)                                                NULL,
        \`created_by\`           varchar(255)                                                NULL,
        \`created_at\`           datetime(6)                                                 NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`invoice_adjustments\` ADD CONSTRAINT \`FK_invoice_adjustments_invoice\` FOREIGN KEY (\`invoice_id\`) REFERENCES \`invoices\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 9. invoice_items (FK: invoices) ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`invoice_items\` (
        \`id\`              varchar(36)                        NOT NULL,
        \`invoice_id\`      varchar(255)                       NOT NULL,
        \`type\`            enum('plan','feature','adjustment') NOT NULL,
        \`ref_id\`          varchar(255)                       NULL,
        \`description\`     varchar(255)                       NOT NULL,
        \`quantity\`        int                                NOT NULL DEFAULT 1,
        \`unit_price\`      decimal(10,2)                      NOT NULL,
        \`amount\`          decimal(10,2)                      NOT NULL,
        \`original_amount\` decimal(10,2)                      NULL,
        \`is_adjusted\`     tinyint                            NOT NULL DEFAULT 0,
        \`created_at\`      datetime(6)                        NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`      datetime(6)                        NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`invoice_items\` ADD CONSTRAINT \`FK_invoice_items_invoice\` FOREIGN KEY (\`invoice_id\`) REFERENCES \`invoices\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // ── 10. payments (FK: invoices, admins) ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`payments\` (
        \`id\`              varchar(36)                                                      NOT NULL,
        \`payment_no\`      varchar(255)                                                     NULL,
        \`invoice_id\`      varchar(255)                                                     NOT NULL,
        \`amount\`          decimal(10,2)                                                    NULL,
        \`method\`          enum('transfer','qr','cash')                                     NOT NULL,
        \`slip_url\`        text                                                             NULL,
        \`status\`          enum('pending','approved','rejected','refunded','partially_refunded') NOT NULL DEFAULT 'pending',
        \`refunded_amount\` decimal(10,2)                                                    NOT NULL DEFAULT '0.00',
        \`approved_by\`     varchar(191)                                                     NULL,
        \`approved_at\`     timestamp                                                        NULL,
        \`created_at\`      datetime(6)                                                      NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_payments_payment_no\` (\`payment_no\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_payments_invoice\` FOREIGN KEY (\`invoice_id\`) REFERENCES \`invoices\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_payments_admin\` FOREIGN KEY (\`approved_by\`) REFERENCES \`admins\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // ── 11. payment_refunds (FK: payments) ────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`payment_refunds\` (
        \`id\`              varchar(36)                                              NOT NULL,
        \`payment_id\`      varchar(255)                                             NOT NULL,
        \`refund_no\`       varchar(255)                                             NOT NULL,
        \`amount\`          decimal(10,2)                                            NOT NULL,
        \`status\`          enum('pending','approved','rejected','completed')         NOT NULL DEFAULT 'pending',
        \`method\`          enum('original_method','bank_transfer','credit')          NOT NULL DEFAULT 'original_method',
        \`reason\`          text                                                     NOT NULL,
        \`notes\`           text                                                     NULL,
        \`bank_account\`    varchar(255)                                             NULL,
        \`bank_name\`       varchar(255)                                             NULL,
        \`account_holder\`  varchar(255)                                             NULL,
        \`credit_id\`       varchar(255)                                             NULL,
        \`processed_at\`    timestamp                                                NULL,
        \`processed_by\`    varchar(255)                                             NULL,
        \`rejected_reason\` text                                                     NULL,
        \`created_by\`      varchar(255)                                             NULL,
        \`created_at\`      datetime(6)                                              NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_payment_refunds_refund_no\` (\`refund_no\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`payment_refunds\` ADD CONSTRAINT \`FK_payment_refunds_payment\` FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 12. subscription_features (FK: subscriptions, features) ──────────
    await queryRunner.query(`
      CREATE TABLE \`subscription_features\` (
        \`id\`              varchar(36)   NOT NULL,
        \`subscription_id\` varchar(255)  NOT NULL,
        \`feature_id\`      varchar(255)  NOT NULL,
        \`quantity\`        int           NULL DEFAULT 1,
        \`price\`           decimal(10,2) NOT NULL,
        \`is_active\`       tinyint       NOT NULL DEFAULT 1,
        \`created_at\`      datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`      datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`subscription_features\` ADD CONSTRAINT \`FK_subscription_features_subscription\` FOREIGN KEY (\`subscription_id\`) REFERENCES \`subscriptions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription_features\` ADD CONSTRAINT \`FK_subscription_features_feature\` FOREIGN KEY (\`feature_id\`) REFERENCES \`features\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // ── 13. subscription_feature_logs (FK: subscription_features) ────────
    await queryRunner.query(`
      CREATE TABLE \`subscription_feature_logs\` (
        \`id\`                       varchar(36)                     NOT NULL,
        \`subscription_feature_id\`  varchar(255)                    NULL,
        \`subscription_id\`          varchar(255)                    NOT NULL,
        \`feature_id\`               varchar(255)                    NOT NULL,
        \`feature_name\`             varchar(255)                    NOT NULL,
        \`action\`                   enum('added','updated','removed') NOT NULL,
        \`old_price\`                decimal(10,2)                   NULL,
        \`new_price\`                decimal(10,2)                   NULL,
        \`old_quantity\`             int                             NULL,
        \`new_quantity\`             int                             NULL,
        \`prorated_amount\`          decimal(10,2)                   NULL,
        \`credit_amount\`            decimal(10,2)                   NULL,
        \`reason\`                   text                            NULL,
        \`effective_date\`           date                            NULL,
        \`created_by\`               varchar(255)                    NULL,
        \`created_at\`               datetime(6)                     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`subscription_feature_logs\` ADD CONSTRAINT \`FK_sub_feature_logs_sub_feature\` FOREIGN KEY (\`subscription_feature_id\`) REFERENCES \`subscription_features\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ── 14. billing_history (FK: subscriptions, invoices) ─────────────────
    await queryRunner.query(`
      CREATE TABLE \`billing_history\` (
        \`id\`                varchar(36)                                                                   NOT NULL,
        \`subscription_id\`   varchar(255)                                                                  NOT NULL,
        \`invoice_id\`        varchar(255)                                                                  NULL,
        \`event_type\`        enum('created','renewed','upgraded','downgraded','cycle_changed','cancelled','reactivated','expired') NOT NULL,
        \`description\`       text                                                                          NULL,
        \`old_plan_id\`       varchar(255)                                                                  NULL,
        \`new_plan_id\`       varchar(255)                                                                  NULL,
        \`old_billing_cycle\` varchar(255)                                                                  NULL,
        \`new_billing_cycle\` varchar(255)                                                                  NULL,
        \`old_amount\`        decimal(10,2)                                                                 NULL,
        \`new_amount\`        decimal(10,2)                                                                 NULL,
        \`period_start\`      date                                                                          NULL,
        \`period_end\`        date                                                                          NULL,
        \`created_by\`        varchar(255)                                                                  NULL,
        \`metadata\`          json                                                                          NULL,
        \`created_at\`        datetime(6)                                                                   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`billing_history\` ADD CONSTRAINT \`FK_billing_history_subscription\` FOREIGN KEY (\`subscription_id\`) REFERENCES \`subscriptions\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`billing_history\` ADD CONSTRAINT \`FK_billing_history_invoice\` FOREIGN KEY (\`invoice_id\`) REFERENCES \`invoices\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ── 15. tenant_credits (FK: tenants) ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`tenant_credits\` (
        \`id\`               varchar(36)                                                  NOT NULL,
        \`tenant_id\`        varchar(255)                                                 NOT NULL,
        \`type\`             enum('manual','refund','proration','promotion','cancellation') NOT NULL DEFAULT 'manual',
        \`status\`           enum('available','used','expired','cancelled')                NOT NULL DEFAULT 'available',
        \`original_amount\`  decimal(10,2)                                                NOT NULL,
        \`remaining_amount\` decimal(10,2)                                                NOT NULL,
        \`description\`      text                                                         NULL,
        \`reference_type\`   varchar(255)                                                 NULL,
        \`reference_id\`     varchar(255)                                                 NULL,
        \`expires_at\`       timestamp                                                    NULL,
        \`used_at\`          timestamp                                                    NULL,
        \`created_by\`       varchar(255)                                                 NULL,
        \`created_at\`       datetime(6)                                                  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(
      `ALTER TABLE \`tenant_credits\` ADD CONSTRAINT \`FK_tenant_credits_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse FK dependency order (children before parents)
    await queryRunner.query(
      `ALTER TABLE \`tenant_credits\` DROP FOREIGN KEY \`FK_tenant_credits_tenant\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`tenant_credits\``);

    await queryRunner.query(
      `ALTER TABLE \`billing_history\` DROP FOREIGN KEY \`FK_billing_history_invoice\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`billing_history\` DROP FOREIGN KEY \`FK_billing_history_subscription\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`billing_history\``);

    await queryRunner.query(
      `ALTER TABLE \`subscription_feature_logs\` DROP FOREIGN KEY \`FK_sub_feature_logs_sub_feature\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`subscription_feature_logs\``);

    await queryRunner.query(
      `ALTER TABLE \`subscription_features\` DROP FOREIGN KEY \`FK_subscription_features_feature\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription_features\` DROP FOREIGN KEY \`FK_subscription_features_subscription\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`subscription_features\``);

    await queryRunner.query(
      `ALTER TABLE \`payment_refunds\` DROP FOREIGN KEY \`FK_payment_refunds_payment\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`payment_refunds\``);

    await queryRunner.query(`ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_payments_admin\``);
    await queryRunner.query(`ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_payments_invoice\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`payments\``);

    await queryRunner.query(
      `ALTER TABLE \`invoice_items\` DROP FOREIGN KEY \`FK_invoice_items_invoice\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`invoice_items\``);

    await queryRunner.query(
      `ALTER TABLE \`invoice_adjustments\` DROP FOREIGN KEY \`FK_invoice_adjustments_invoice\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`invoice_adjustments\``);

    await queryRunner.query(
      `ALTER TABLE \`invoices\` DROP FOREIGN KEY \`FK_invoices_subscription\``,
    );
    await queryRunner.query(`ALTER TABLE \`invoices\` DROP FOREIGN KEY \`FK_invoices_tenant\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`invoices\``);

    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_subscriptions_previous_plan\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_subscriptions_plan\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_subscriptions_tenant\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`subscriptions\``);

    await queryRunner.query(
      `ALTER TABLE \`plan_features\` DROP FOREIGN KEY \`FK_plan_features_feature\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`plan_features\` DROP FOREIGN KEY \`FK_plan_features_plan\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`plan_features\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`tenants\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`features\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`plans\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`admins\``);
  }
}
