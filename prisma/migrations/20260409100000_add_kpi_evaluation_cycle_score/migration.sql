-- ============================================================
-- Migration: add_kpi_evaluation_cycle_score
-- Date: 2026-04-09
-- Description:
--   1. Alter hr_performances — เพิ่ม cycleId, templateId, rejectionReason
--                             — ทำ reviewDate nullable
--                             — เปลี่ยน status default → 'pending'
--                             — เปลี่ยน unique constraint
--   2. CreateTable hr_evaluation_cycles
--   3. CreateTable hr_kpi_scores
--   4. AddForeignKeys
-- ============================================================

-- ─── Step 1: Alter hr_performances ───────────────────────────────────────────

-- 1a. เพิ่ม columns ใหม่
ALTER TABLE `hr_performances`
  ADD COLUMN `cycleId`         VARCHAR(191) NULL,
  ADD COLUMN `templateId`      VARCHAR(191) NULL,
  ADD COLUMN `rejectionReason` TEXT         NULL;

-- 1b. ทำ reviewDate nullable (เดิม NOT NULL)
ALTER TABLE `hr_performances`
  MODIFY COLUMN `reviewDate` DATE NULL;

-- 1c. เปลี่ยน status default จาก 'draft' → 'pending'
--     (records เดิมยังคง status เดิม — ไม่ UPDATE เพราะ backward compat)
ALTER TABLE `hr_performances`
  MODIFY COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'pending';

-- 1d. Drop unique constraint เดิม (employeeId, period)
DROP INDEX `hr_performances_employeeId_period_key` ON `hr_performances`;

-- 1e. เพิ่ม unique constraint ใหม่ (employeeId, period, cycleId)
--     MySQL อนุญาต multiple NULLs ใน unique index → legacy records (cycleId=NULL) ปลอดภัย
ALTER TABLE `hr_performances`
  ADD UNIQUE INDEX `hr_performances_employeeId_period_cycleId_key`(`employeeId`, `period`, `cycleId`);

-- 1f. เพิ่ม index สำหรับ cycleId
ALTER TABLE `hr_performances`
  ADD INDEX `hr_performances_cycleId_idx`(`cycleId`);

-- ─── Step 2: CreateTable hr_evaluation_cycles ────────────────────────────────

CREATE TABLE `hr_evaluation_cycles` (
    `id`          VARCHAR(191) NOT NULL,
    `tenantId`    VARCHAR(191) NOT NULL,
    `templateId`  VARCHAR(191) NOT NULL,
    `name`        VARCHAR(191) NOT NULL,
    `period`      VARCHAR(191) NOT NULL,
    `periodType`  VARCHAR(191) NOT NULL DEFAULT 'quarterly',
    `startDate`   DATE         NOT NULL,
    `endDate`     DATE         NOT NULL,
    `dueDate`     DATE         NOT NULL,
    `status`      VARCHAR(191) NOT NULL DEFAULT 'open',
    `description` TEXT         NULL,
    `createdBy`   VARCHAR(191) NULL,
    `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3)  NOT NULL,

    INDEX `hr_evaluation_cycles_tenantId_idx`(`tenantId`),
    INDEX `hr_evaluation_cycles_templateId_idx`(`templateId`),
    INDEX `hr_evaluation_cycles_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Step 3: CreateTable hr_kpi_scores ───────────────────────────────────────

CREATE TABLE `hr_kpi_scores` (
    `id`            VARCHAR(191)   NOT NULL,
    `performanceId` VARCHAR(191)   NOT NULL,
    `criteriaId`    VARCHAR(191)   NOT NULL,
    `criteriaName`  VARCHAR(191)   NOT NULL,
    `weight`        DECIMAL(5, 2)  NOT NULL,
    `score`         DECIMAL(5, 2)  NOT NULL,
    `comment`       TEXT           NULL,
    `createdAt`     DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`     DATETIME(3)    NOT NULL,

    UNIQUE INDEX `hr_kpi_scores_performanceId_criteriaId_key`(`performanceId`, `criteriaId`),
    INDEX `hr_kpi_scores_performanceId_idx`(`performanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Step 4: AddForeignKeys ───────────────────────────────────────────────────

-- hr_performances.cycleId → hr_evaluation_cycles.id (SET NULL on delete)
ALTER TABLE `hr_performances`
  ADD CONSTRAINT `hr_performances_cycleId_fkey`
  FOREIGN KEY (`cycleId`) REFERENCES `hr_evaluation_cycles`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- hr_evaluation_cycles.templateId → hr_kpi_templates.id
ALTER TABLE `hr_evaluation_cycles`
  ADD CONSTRAINT `hr_evaluation_cycles_templateId_fkey`
  FOREIGN KEY (`templateId`) REFERENCES `hr_kpi_templates`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- hr_kpi_scores.performanceId → hr_performances.id (CASCADE)
ALTER TABLE `hr_kpi_scores`
  ADD CONSTRAINT `hr_kpi_scores_performanceId_fkey`
  FOREIGN KEY (`performanceId`) REFERENCES `hr_performances`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- hr_kpi_scores.criteriaId → hr_kpi_template_items.id
ALTER TABLE `hr_kpi_scores`
  ADD CONSTRAINT `hr_kpi_scores_criteriaId_fkey`
  FOREIGN KEY (`criteriaId`) REFERENCES `hr_kpi_template_items`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
