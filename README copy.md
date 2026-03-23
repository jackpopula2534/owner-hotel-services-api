# 📚 Documentation Index

Welcome to the Hotel Management System documentation! เอกสารนี้จะช่วยให้ทีมพัฒนาสามารถเริ่มงาน แบ่งงาน และติดตามความคืบหน้าได้อย่างมีประสิทธิภาพ

---

## 📖 เอกสารทั้งหมด

### 1. 🎯 [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md)
**สำหรับ**: Project Manager, Team Lead, Developers

**เนื้อหา**:
- รายละเอียดครบถ้วนของทุก task ที่ต้องพัฒนา
- แบ่งเป็น Backend (36 tasks) และ Frontend (23 tasks)
- มี Priority (P0-P3), Effort estimation, Dependencies
- Acceptance Criteria สำหรับแต่ละ task
- แนะนำการแบ่งงานให้ทีม

**เมื่อไหร่ใช้**:
- วางแผน Sprint Planning
- มอบหมายงานให้ทีม
- ประมาณการเวลาและทรัพยากร
- ตรวจสอบความสมบูรณ์ของแต่ละ task

---

### 2. 📊 [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md)
**สำหรับ**: ทุกคนในทีม (อัพเดทประจำวัน)

**เนื้อหา**:
- Kanban Board (TODO, IN PROGRESS, DONE, BLOCKED)
- Sprint velocity tracking
- Burndown chart data
- Team member progress
- Milestone timeline
- Overall progress metrics

**เมื่อไหร่ใช้**:
- Daily standup meetings
- รับ/ส่งมอบ tasks
- อัพเดทสถานะงานของตัวเอง
- รายงานความคืบหน้าให้ทีม
- ติดตามว่าทีมมีงานค้างหรือ blocked อะไรบ้าง

**วิธีอัพเดท**:
```markdown
# เมื่อเริ่มงาน task ใหม่
1. ย้าย task จาก "TODO" ไปที่ "IN PROGRESS"
2. ใส่ชื่อของคุณใน Owner
3. อัพเดทสถานะ emoji เป็น 🟡

# เมื่อทำเสร็จ
1. ย้าย task จาก "IN PROGRESS" ไปที่ "DONE"
2. อัพเดทสถานะ emoji เป็น 🟢
3. อัพเดท Overall Progress table

# เมื่อติดปัญหา
1. ย้าย task ไปที่ "BLOCKED"
2. อัพเดทสถานะ emoji เป็น 🔴
3. เพิ่มรายละเอียดใน "Blockers & Risks" section
```

---

### 3. 🚀 [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md)
**สำหรับ**: นักพัฒนาใหม่, Onboarding

**เนื้อหา**:
- ขั้นตอนการเริ่มต้นพัฒนา (Setup environment)
- Development workflow แบบ step-by-step
- Code style guidelines และ examples
- Testing guidelines
- Git workflow และ PR process
- Debugging tips
- Common issues & solutions

**เมื่อไหร่ใช้**:
- มีนักพัฒนาคนใหม่เข้าทีม
- ต้องการทบทวน best practices
- ไม่แน่ใจวิธีการทำงานบาง process
- อ้างอิงตัวอย่าง code

---

### 4. 📝 [workflow/](./workflow/)
**สำหรับ**: ทีมทั้งหมด

**เนื้อหา**:
- Detailed workflow documentation
- Architecture diagrams
- API specifications
- Database schema
- System design documents

---

## 🎯 Quick Links

### สำหรับ Project Manager
1. [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md) - ดู task ทั้งหมดและ priority
2. [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - ติดตามความคืบหน้า
3. Summary Table (TASK_BREAKDOWN.md) - ดูภาพรวม effort และ priority

### สำหรับ Team Lead
1. [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md) - แบ่งงานให้ทีม
2. [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - Sprint planning และ velocity
3. [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) - Onboard นักพัฒนาใหม่

### สำหรับ Backend Developer
1. [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md) - ดู Backend Tasks (BE-*)
2. [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - เลือก task และอัพเดทสถานะ
3. [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) - Backend Development section

### สำหรับ Frontend Developer
1. [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md) - ดู Frontend Tasks (FE-*)
2. [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - เลือก task และอัพเดทสถานะ
3. [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) - Frontend Development section

### สำหรับนักพัฒนาใหม่
1. เริ่มที่ [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) - อ่านทั้งหมด!
2. [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md) - ทำความเข้าใจ task ที่จะได้รับมอบหมาย
3. [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - เรียนรู้วิธีอัพเดทสถานะ

---

## 📈 Development Roadmap

### Phase 1: Critical Features (P0) - 6-8 weeks
**Focus**: Email Notifications, PromptPay Payment, Export Reports

**Tasks**: 15 tasks (9 Backend + 6 Frontend)

**Deliverables**:
- ✅ Email notification system
- ✅ PromptPay payment integration
- ✅ Excel/PDF export functionality

---

### Phase 2: Important Features (P1) - 8-10 weeks
**Focus**: 2FA, Audit Logging, Advanced Analytics, Performance

**Tasks**: 29 tasks (18 Backend + 11 Frontend)

**Deliverables**:
- ✅ Two-factor authentication
- ✅ Complete audit logging
- ✅ Revenue & occupancy dashboards
- ✅ Redis caching & optimization

---

### Phase 3: Nice to Have (P2) - 4-6 weeks
**Focus**: Line Notify, Multi-language, Advanced Performance

**Tasks**: 12 tasks (7 Backend + 5 Frontend)

**Deliverables**:
- ✅ Line Notify integration
- ✅ TH/EN language support
- ✅ Client-side caching
- ✅ Custom report builder

---

### Phase 4: Future (P3) - TBD
**Focus**: Mobile App

**Tasks**: 3 tasks (2 Backend + 1 Mobile)

**Deliverables**:
- ✅ Mobile API endpoints
- ✅ Push notifications
- ✅ iOS & Android apps

---

## 🔄 Daily Workflow

### Morning (9:00 AM)
```markdown
1. Pull latest changes: `git pull origin main`
2. อ่าน Slack updates
3. ตรวจสอบ PROGRESS_TRACKER.md - ดู tasks ของตัวเอง
```

### Daily Standup (10:00 AM)
```markdown
รายงาน 3 อย่าง:
1. Yesterday: ทำอะไรเมื่อวาน
2. Today: จะทำอะไรวันนี้
3. Blockers: มีปัญหาอะไรหรือไม่
```

### During Development
```markdown
1. ทำงาน task ตาม QUICK_START_GUIDE.md
2. Commit บ่อยๆ (atomic commits)
3. อัพเดท PROGRESS_TRACKER.md เมื่อเปลี่ยนสถานะ
```

### Before End of Day (6:00 PM)
```markdown
1. Push code ขึ้น remote branch
2. อัพเดท PROGRESS_TRACKER.md
3. แจ้ง blockers ใน Slack (ถ้ามี)
```

---

## 📋 Meeting Schedule

### Daily Standup
- **เวลา**: ทุกวันเวลา 10:00 AM
- **ระยะเวลา**: 15 นาที
- **เตรียมมา**: อ่าน PROGRESS_TRACKER.md ก่อน

### Sprint Planning
- **เวลา**: ทุกวันจันทร์เวลา 2:00 PM
- **ระยะเวลา**: 2 ชั่วโมง
- **เตรียมมา**: อ่าน TASK_BREAKDOWN.md, คิด effort estimation

### Sprint Review
- **เวลา**: ทุกวันศุกร์ (ปลายสปรินต์) เวลา 3:00 PM
- **ระยะเวลา**: 1 ชั่วโมง
- **เตรียมมา**: Demo งานที่ทำเสร็จ

### Sprint Retrospective
- **เวลา**: ทุกวันศุกร์ (ปลายสปรินต์) เวลา 4:00 PM
- **ระยะเวลา**: 1 ชั่วโมง
- **เตรียมมา**: คิด "What went well", "What to improve"

---

## 🎓 Best Practices

### 1. การ Commit
```bash
# ✅ Good
git commit -m "feat(email): add booking confirmation template (BE-EMAIL-002)"
git commit -m "fix(payment): resolve QR timeout issue"

# ❌ Bad
git commit -m "update"
git commit -m "fix bug"
git commit -m "wip"
```

### 2. การสร้าง PR
- **Title**: ใส่ Task ID เสมอ `[BE-EMAIL-001] Email Service Setup`
- **Description**: ใช้ template ใน QUICK_START_GUIDE.md
- **Size**: พยายามให้ PR ไม่เกิน 500 บรรทัด (ถ้าเกินให้แยก PR)

### 3. การ Review Code
- Review ภายใน 24 ชั่วโมง
- ให้ feedback ที่สร้างสรรค์
- Approve เมื่อผ่าน checklist ทั้งหมด

### 4. การทดสอบ
- เขียน test ก่อน push ทุกครั้ง
- รัน `npm test` ให้ผ่านก่อน commit
- ตรวจสอบ coverage ไม่ต่ำกว่า 80%

---

## 🆘 ติดปัญหาหา Help ได้ที่ไหน?

### Technical Issues
1. **อ่าน**: [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) - Common Issues section
2. **ถาม**: Slack channel `#hotel-management-dev`
3. **Search**: เช็ค GitHub Issues ว่ามีคนเจอปัญหาเดียวกันหรือไม่

### Task Clarification
1. **อ่าน**: [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md) - Acceptance Criteria
2. **ถาม**: Team Lead ใน Slack
3. **Discuss**: ยก issue ใน standup meeting

### Process Questions
1. **อ่าน**: [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) - Development Workflow
2. **ถาม**: Team Lead หรือ Project Manager

---

## 📞 Contact Information

### Project Team
- **Project Manager**: [Name] - [Email] - Slack: @pm
- **Tech Lead (Backend)**: [Name] - [Email] - Slack: @tech-lead-be
- **Tech Lead (Frontend)**: [Name] - [Email] - Slack: @tech-lead-fe

### Slack Channels
- `#hotel-management-dev` - General development discussion
- `#hotel-management-backend` - Backend-specific
- `#hotel-management-frontend` - Frontend-specific
- `#hotel-management-deploy` - Deployment notifications

### Emergency Contact
- **On-call**: [Phone Number]
- **Email**: emergency@hotel-management.com

---

## 📌 Important Links

### Repositories
- **Main Repo**: [GitHub URL]
- **Backend API**: [GitHub URL]
- **Mobile App**: [GitHub URL] (future)

### Environments
- **Staging**: https://staging.hotel-management.com
- **Production**: https://app.hotel-management.com
- **API Staging**: https://api-staging.hotel-management.com
- **API Production**: https://api.hotel-management.com

### Tools
- **Jira/Trello**: [URL] (if applicable)
- **Figma Designs**: [URL]
- **API Documentation**: http://localhost:9011/api/docs (Swagger)

---

## 📝 Document Maintenance

### อัพเดทเอกสาร
- **PROGRESS_TRACKER.md**: อัพเดททุกวัน (ทีมพัฒนา)
- **TASK_BREAKDOWN.md**: อัพเดทเมื่อมี task ใหม่ (Project Manager)
- **QUICK_START_GUIDE.md**: อัพเดทเมื่อมี process เปลี่ยน (Tech Lead)
- **README.md (นี่)**: อัพเดทเมื่อมีเอกสารใหม่ (Project Manager)

### Version Control
- เอกสารทั้งหมดอยู่ใน Git
- Commit เมื่อมีการเปลี่ยนแปลงสำคัญ
- ใส่ "Last Updated" date ในแต่ละไฟล์

---

## 🎉 Let's Build Something Amazing!

ขอให้ทุกคนมีความสุขกับการพัฒนา และอย่าลืมว่า:
- 💬 **Communication is key** - ถามเมื่อไม่เข้าใจ
- 🤝 **Help each other** - ช่วยเหลือเพื่อนร่วมทีม
- 📚 **Document everything** - เขียนเอกสารให้ครบถ้วน
- ✅ **Test thoroughly** - ทดสอบให้ดีก่อน deploy
- 🚀 **Ship quality code** - Code ที่ดีคือ Code ที่ maintainable

---

_Happy Coding! 🎨💻🚀_

_Last updated: 2026-03-21_
