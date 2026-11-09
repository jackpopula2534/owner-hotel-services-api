import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAddonTrialRequests20260513120000 implements MigrationInterface {
  name = 'AddAddonTrialRequests20260513120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`addon_trial_requests\` (
        \`id\`          VARCHAR(36)   NOT NULL,
        \`tenant_id\`   VARCHAR(255)  NOT NULL,
        \`addon_code\`  VARCHAR(100)  NOT NULL,
        \`addon_name\`  VARCHAR(255)  NULL,
        \`status\`      ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
        \`note\`        TEXT          NULL,
        \`admin_note\`  TEXT          NULL,
        \`approved_by\` VARCHAR(255)  NULL,
        \`approved_at\` DATETIME(6)   NULL,
        \`expires_at\`  DATETIME(6)   NULL,
        \`created_at\`  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_addon_trial_tenant\`       (\`tenant_id\`),
        INDEX \`idx_addon_trial_status\`       (\`status\`),
        INDEX \`idx_addon_trial_tenant_code\`  (\`tenant_id\`, \`addon_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`addon_trial_requests\``);
  }
}
