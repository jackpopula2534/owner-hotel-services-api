# ⏸️ PARKED — Multi-package (Hotel + Camp) Support

ตัดสินใจ 2026-09-23: **ขายทีละ 1 package ต่อ tenant เหมือนเดิม** งานฝั่ง API ในเอกสารนี้ **ยังไม่ทำ**
เก็บไว้เป็น reference ถ้าวันหนึ่งจะขายควบ

เอกสารฉบับเต็ม: `owner-hotel-services/docs/design/2026-09-23-owner-workspace-product-line-split.md`

สรุปสั้น ๆ ว่าถ้าจะทำต้องแตะอะไร:
- `subscriptions.system` + index + backfill จาก `plans.system`
- `subscriptions.service.ts` → `findByTenantId(tenantId, system?)`
- caller 10 จุดที่ resolve subscription จาก tenantId ล้วน
  (`subscription.guard.ts:102` · `feature-access.service.ts:55,199` · `subscription.controller.ts:19`
   · `subscriptions.service.ts:232,248` · `addon.guard.ts:133` · `hr-addon.guard.ts:50`
   · `self-service-plan.service.ts:97,201` · `payments.service.ts:251`)
- โมดูล `src/workspaces/` + claim `productLine` ใน JWT

---

## ➡️ งานที่ทำต่อจริงคือ: Unified User Management

เอกสารฉบับเต็ม: `owner-hotel-services/docs/design/2026-09-23-owner-user-management-ux.md`

ฝั่ง API ต้องทำ:
- [ ] ตารางใหม่ `user_terminal_access` (userId, terminal, role, permissions, approvalLimit, scopeIds)
      + migration backfill จาก `users.allowedSystems` / `users.role` / `procurementPermissions` /
      `warehousePermissions` / `warehouseIds`
      **ต้อง sync กลับไปที่ `User.allowedSystems` ทุกครั้ง** เพราะ `common/guards/system.guard.ts`
      และ `modules/auth/auth.service.ts` อ่านฟิลด์นั้น
- [ ] `TERMINAL_REGISTRY` — รวม role list + default permissions ของทุก terminal ไว้ที่เดียว
      (ตอนนี้กระจายอยู่ใน DTO ของ 6 โมดูล: `HOTEL_TERMINAL_ROLES` `POS_ROLES` `PROCUREMENT_ROLES`
      `WAREHOUSE_ROLES` `ACCOUNTING_ROLES` `HR_ROLES`)
- [ ] โมดูลใหม่ `src/modules/tenant-users/` — list · matrix · stats · create(+grants) ·
      access · bulk-access · suspend · import-employees · terminals
- [ ] บังคับ `plans.max_users` ตอนสร้างผู้ใช้ (ตอนนี้ไม่มีการเช็ค seat)
- [ ] 6 โมดูลเดิม (`hotel-terminal-users` `warehouse-users` `procurement-users` `accounting-users`
      `hr-terminal-users` + POS user ใน `auth`) → ทำเป็น thin wrapper ก่อน ค่อย deprecate
- [ ] ยก `importable-employees` / `import-bulk` / `sync-roster` จาก `hotel-terminal-users`
      ขึ้นเป็น generic ใช้ได้ทุก terminal

⚠️ **ห้ามเปลี่ยนความหมายของ `users.role`** — มี `@Roles()` กว่า 40 จุดอ่านฟิลด์นี้
`users.role` = บทบาทหลักสำหรับ dashboard, บทบาทต่อ terminal อยู่ใน `user_terminal_access` เท่านั้น
