-- รูปโปรไฟล์ของผู้ใช้ — เก็บ path จาก StorageService (local: /uploads/avatars/..., s3: URL เต็ม)
ALTER TABLE `users` ADD COLUMN `avatarUrl` VARCHAR(500) NULL;
