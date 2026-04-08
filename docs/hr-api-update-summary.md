# 📋 API Update Summary: ระบบ HR (พนักงาน)

> **วันที่อัปเดต:** 2026-04-08
> **Module:** HR / Staff Management
> **สถานะ:** ✅ Backend พร้อมแล้ว — รอ Frontend รับ

---

## 🔗 Endpoints ที่ได้รับผลกระทบ

| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| `POST` | `/api/v1/hr` | สร้างพนักงานใหม่ |
| `PATCH` | `/api/v1/hr/:id` | แก้ไขข้อมูลพนักงาน |
| `GET` | `/api/v1/hr` | ดึงรายชื่อพนักงานทั้งหมด |
| `GET` | `/api/v1/hr/:id` | ดึงรายละเอียดพนักงานรายบุคคล |

---

## 📥 1. การเปลี่ยนแปลงฝั่ง Request Payload

> ทุกฟิลด์ใหม่เป็น **Optional** — ส่งมาเท่าที่มีได้เลย

### 🏨 1.1 การผูกสาขา (Property Relation)

เพิ่มฟิลด์เพื่อระบุว่าพนักงานคนนี้ประจำสาขาไหน:

```json
{
  "hotelId": "UUID"
}
```

> **หมายเหตุ:** API จะ map `hotelId` → `propertyId` อัตโนมัติ ไม่ต้องส่ง `propertyId` ตรงๆ

---

### 🗓️ 1.2 รูปแบบวันที่ (Date Format)

Backend มีตัวแปลงข้อมูลไว้ให้แล้ว ส่งเป็น String ISO-8601 ได้เลย:

```json
{
  "startDate": "2023-07-01",
  "dateOfBirth": "1990-05-15"
}
```

> รูปแบบที่รองรับ: `YYYY-MM-DD`

---

### 💰 1.3 ข้อมูลการเงินและสวัสดิการ

```json
{
  "taxId": "4968838846962",
  "socialSecurity": "3489509123218",
  "baseSalary": 26846,
  "allowance": 1456,
  "overtime": 1940,
  "positionBonus": 5159
}
```

| Field | Type | คำอธิบาย |
|-------|------|-----------|
| `taxId` | `string` | หมายเลขผู้เสียภาษี |
| `socialSecurity` | `string` | หมายเลขประกันสังคม |
| `baseSalary` | `number` | เงินเดือนตั้งต้น |
| `allowance` | `number` | เงินช่วยเหลือ / เบี้ยเลี้ยง |
| `overtime` | `number` | ค่าโอที |
| `positionBonus` | `number` | เงินประจำตำแหน่ง |

---

### 🧑‍🎓 1.4 ประวัติการศึกษาและการทำงาน (JSON Arrays)

ส่งเป็น Array of Objects ได้ตรงๆ ตามโครงสร้างด้านล่าง:

```json
{
  "educations": [
    {
      "id": "edu-1",
      "level": "BACHELOR",
      "institution": "มหาวิทยาลัยเชียงใหม่",
      "major": "การโรงแรม",
      "graduationYear": "2020",
      "gpa": "3.50"
    }
  ],
  "workExperiences": [ ... ],
  "emergencyContacts": [ ... ]
}
```

**ค่าที่รองรับสำหรับ `education.level`:**
`BACHELOR` | `MASTER` | `DOCTORATE` | `DIPLOMA` | `HIGH_SCHOOL` | `OTHER`

---

## 📤 2. การเปลี่ยนแปลงฝั่ง Response

### 2.1 เพิ่ม `propertyId` ในเรคคอร์ดพนักงาน

ใช้สำหรับกรองหรือแสดงผลบน UI ตามสาขาโรงแรม

---

### 2.2 Include Relations — แผนกและตำแหน่งแนบมาพร้อม

**ไม่ต้องยิง API เพิ่มเพื่อหาชื่อแผนก** ข้อมูลครบมาในก้อนเดียว:

```json
{
  "id": "...",
  "firstName": "สมชาย",
  "propertyId": "UUID_ของสาขา",
  "departmentId": "UUID_ของแผนก",
  "positionId": "UUID_ของตำแหน่ง",
  "hrDepartment": {
    "id": "...",
    "name": "ฝ่ายต้อนรับ",
    "nameEn": "Front Office",
    "code": "FO",
    "color": "#8B5CF6"
  },
  "hrPosition": {
    "id": "...",
    "name": "ผู้จัดการฝ่ายต้อนรับ",
    "level": 8
  }
}
```

---

## 🎯 Checklist สำหรับทีม Frontend

### หน้า List พนักงาน (Table)
- [ ] ใช้ `hrDepartment.color` สำหรับแสดง color badge ของแผนก
- [ ] ใช้ `hrDepartment.name` แสดงชื่อแผนกภาษาไทย
- [ ] ใช้ `hrDepartment.nameEn` สำหรับ tooltip หรือ export

### Dropdown Filter (แผนก / ตำแหน่ง)
- [ ] ส่ง Query Parameter เป็น **UUID** เท่านั้น — ห้ามส่งชื่อภาษาไทย/อังกฤษ
  ```
  GET /api/v1/hr?departmentId=UUID&positionId=UUID
  ```

### ฟอร์มสร้าง/แก้ไขพนักงาน
- [ ] ส่ง `hotelId` แทน `propertyId`
- [ ] วันที่ format เป็น `YYYY-MM-DD` string
- [ ] `baseSalary`, `allowance`, `overtime`, `positionBonus` ส่งเป็น `number` (ไม่ใส่ comma)

---

## 💬 ติดต่อทีม Backend

หากมีข้อสงสัยหรือ Response ไม่ตรงกับ spec นี้ ให้แจ้งทีม Backend พร้อมแนบ:
1. Request payload ที่ส่งไป
2. Response ที่ได้รับกลับมา
3. Timestamp ของ request
