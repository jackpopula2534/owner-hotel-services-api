# 🗄️ MAMP Database Setup Guide

## การตั้งค่า MAMP สำหรับโปรเจกต์นี้

### 1. เปิด MAMP และ Start Servers

1. เปิด MAMP application
2. กด "Start Servers"
3. ตรวจสอบว่า MySQL ทำงานอยู่

### 2. เชื่อมต่อ MySQL

**Default MAMP Settings:**
- **Host:** `localhost` หรือ `127.0.0.1`
- **Port:** `8889` (MAMP default) หรือ `3306` (ถ้าใช้ standard MySQL)
- **Username:** `root`
- **Password:** `root`

### 3. สร้าง Database

**วิธีที่ 1: ผ่าน phpMyAdmin**
1. เปิด browser ไปที่ `http://localhost:8888/phpMyAdmin`
2. สร้าง database ใหม่ชื่อ `hotel_services_db`
3. เลือก Collation: `utf8mb4_unicode_ci`

**วิธีที่ 2: ผ่าน Terminal**
```bash
# เชื่อมต่อ MySQL
mysql -u root -proot -h localhost -P 8889

# สร้าง database
CREATE DATABASE hotel_services_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# ออกจาก MySQL
exit;
```

### 4. ตั้งค่าไฟล์ .env

ไฟล์ `.env` ถูกสร้างไว้แล้วพร้อมค่า default สำหรับ MAMP:

```env
DB_HOST=localhost
DB_PORT=8889
DB_USERNAME=root
DB_PASSWORD=root
DB_DATABASE=hotel_services_db
```

**⚠️ หมายเหตุ:**
- ถ้า MAMP ใช้ port `3306` แทน `8889` ให้แก้ไข `DB_PORT=3306`
- ถ้าเปลี่ยน username/password ใน MAMP ให้แก้ไขใน `.env`

### 5. ติดตั้ง Dependencies

```bash
npm install
```

**สำคัญ:** โปรเจกต์ใช้ `mysql2` แทน `pg` (PostgreSQL) แล้ว

### 6. รัน Application

```bash
# Development mode (auto sync database)
npm run start:dev
```

เมื่อรันครั้งแรก TypeORM จะสร้าง tables อัตโนมัติ (ถ้า `synchronize: true`)

### 7. ตรวจสอบการเชื่อมต่อ

ถ้าเห็น log แบบนี้ แสดงว่าเชื่อมต่อสำเร็จ:
```
[Nest] ... TypeORM connection established
```

---

## 🔧 Troubleshooting

### ปัญหา: Cannot connect to database

**แก้ไข:**
1. ตรวจสอบว่า MAMP MySQL ทำงานอยู่
2. ตรวจสอบ port ใน MAMP:
   - เปิด MAMP → Preferences → Ports
   - ดู MySQL Port (default: 8889)
3. ตรวจสอบไฟล์ `.env` ว่า port ถูกต้อง

### ปัญหา: Access denied

**แก้ไข:**
1. ตรวจสอบ username/password ใน `.env`
2. ลอง reset MySQL password ใน MAMP:
   ```bash
   mysql -u root -p
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
   ```

### ปัญหา: Database not found

**แก้ไข:**
1. สร้าง database `hotel_services_db` ก่อน
2. ตรวจสอบชื่อ database ใน `.env`

---

## 📝 MAMP Ports Reference

| Service | Default Port | Alternative |
|---------|-------------|-------------|
| Apache  | 8888        | 80          |
| MySQL   | 8889        | 3306        |

**ถ้าใช้ port อื่น:** แก้ไข `DB_PORT` ใน `.env`

---

## ✅ Checklist

- [ ] MAMP ทำงานอยู่
- [ ] MySQL Server ทำงาน
- [ ] สร้าง database `hotel_services_db` แล้ว
- [ ] ไฟล์ `.env` ตั้งค่าถูกต้อง
- [ ] รัน `npm install` แล้ว
- [ ] รัน `npm run start:dev` สำเร็จ
- [ ] เห็น connection log ใน console

---

## 🚀 Next Steps

หลังจากเชื่อมต่อ database สำเร็จ:

1. **สร้าง Seed Data** (ถ้าต้องการ)
2. **ทดสอบ API endpoints**
3. **ตรวจสอบ tables ใน phpMyAdmin**


