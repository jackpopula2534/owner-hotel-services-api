-- QC checklist guidance: วิธีตรวจ / หน่วย / บังคับระบุสิ่งที่พบเมื่อไม่ผ่าน
ALTER TABLE `qc_checklist_items`
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `unit` VARCHAR(20) NULL,
  ADD COLUMN `requireNoteOnFail` BOOLEAN NOT NULL DEFAULT false;

-- Per-item finding recorded by the inspector
ALTER TABLE `qc_results`
  ADD COLUMN `note` TEXT NULL;
