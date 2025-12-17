# 🔧 Troubleshooting Guide

## ปัญหา: typeorm_metadata table doesn't exist

### อาการ
```
Error: Table 'hotel_services_db.typeorm_metadata' doesn't exist
```

### สาเหตุ
TypeORM พยายาม query `typeorm_metadata` table ที่ไม่มีอยู่ ซึ่งเป็น table ที่ TypeORM ใช้เก็บ metadata สำหรับ migrations

### วิธีแก้ไข

#### วิธีที่ 1: สร้าง typeorm_metadata table (แนะนำ)
```sql
CREATE TABLE IF NOT EXISTS `typeorm_metadata` (
  `type` varchar(255) NOT NULL,
  `database` varchar(255) DEFAULT NULL,
  `schema` varchar(255) DEFAULT NULL,
  `table` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `value` text,
  PRIMARY KEY (`type`, `name`, `schema`, `table`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### วิธีที่ 2: ใช้ db:refresh (อัตโนมัติ)
```bash
npm run db:refresh
```
Script นี้จะสร้าง tables ทั้งหมดรวมถึงจัดการ error นี้ให้อัตโนมัติ

#### วิธีที่ 3: ปิด logging queries
แก้ไข `src/database/database.module.ts`:
```typescript
logging: ['error', 'warn', 'schema'], // แสดงเฉพาะ error, warn, schema
```

### หมายเหตุ
- Error นี้ไม่กระทบการทำงานของระบบ
- เป็น warning ที่ TypeORM แสดงเมื่อ query metadata table
- สามารถ ignore ได้ถ้าไม่ใช้ migrations

---

## ปัญหาอื่นๆ

### Cannot connect to database

**แก้ไข:**
1. ตรวจสอบ MAMP ทำงานอยู่
2. ตรวจสอบ `.env` ตั้งค่าถูกต้อง:
   ```env
   DB_HOST=localhost
   DB_PORT=8889  # หรือ 3306
   DB_USERNAME=root
   DB_PASSWORD=root
   DB_DATABASE=hotel_services_db
   ```
3. ตรวจสอบ database สร้างแล้ว:
   ```sql
   CREATE DATABASE hotel_services_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

### Access denied

**แก้ไข:**
1. ตรวจสอบ username/password ใน `.env`
2. Reset MySQL password:
   ```bash
   mysql -u root -p
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
   ```

### Port already in use

**แก้ไข:**
1. เปลี่ยน port ใน `.env`:
   ```env
   PORT=3001
   ```
2. หรือ kill process ที่ใช้ port:
   ```bash
   lsof -ti:3000 | xargs kill -9
   ```

---

## 🆘 ยังแก้ไม่ได้?

1. ตรวจสอบ logs ใน console
2. ตรวจสอบ database connection ใน phpMyAdmin
3. ลองรัน `npm run db:refresh` ใหม่
4. ตรวจสอบ MAMP MySQL ทำงานอยู่


