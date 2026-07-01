# StaySync — Production Deploy Guide

คู่มือเอาระบบขึ้น production จริง (server จริง + โดเมน + SSL + object storage + backup)
เขียนสำหรับ deploy แบบ **VPS เดียว + docker-compose** ซึ่งคุ้มสุดสำหรับช่วงเริ่มมีลูกค้าจ่ายเงิน
และออกแบบให้ขยาย (scale) ต่อได้โดยไม่ต้องรื้อ

> สถาปัตยกรรม: Next.js (frontend) + NestJS (api) + MySQL 8 + Redis 7 + Caddy (reverse proxy/HTTPS)
> ไฟล์อัพโหลดเก็บบน **Cloudflare R2** (object storage) — ไม่เก็บบน disk ของ container อีกต่อไป

---

## สรุปค่าใช้จ่ายต่อเดือน (โดยประมาณ)

| รายการ | บริการแนะนำ | ค่าใช้จ่าย |
|---|---|---|
| VPS (รัน api+frontend+mysql+redis+caddy) | Hetzner CPX41 (8 vCPU / 16GB) | ~1,050฿ |
| (ทางเลือกประหยัด) | Hetzner CPX31 (4 vCPU / 8GB) | ~580฿ |
| Object storage (ไฟล์อัพโหลด) | Cloudflare R2 (10GB ฟรี, egress ฟรี) | ~0–60฿ |
| Backup storage | Cloudflare R2 (db dump) | รวมข้างบน |
| DNS + SSL + CDN + DDoS | Cloudflare Free | ฟรี |
| โดเมน .com | Cloudflare Registrar / Namecheap | ~30฿ (เฉลี่ยจาก ~400฿/ปี) |
| VPS auto-backup (snapshot) | Hetzner (+20%) | ~120–210฿ |
| **รวมเริ่มต้น** | | **~750–1,500฿/เดือน** |

---

## ขั้นที่ 0 — เตรียมของ

1. **โดเมน:** จดที่ Cloudflare Registrar (ราคาทุน) หรือ Namecheap — เช่น `example.com`
2. **บัญชี Cloudflare:** เพิ่ม domain เข้า Cloudflare, ชี้ nameserver ตามที่ Cloudflare บอก
3. **VPS:** สมัคร Hetzner Cloud / DigitalOcean สร้าง Ubuntu 22.04/24.04
4. **Cloudflare R2:** เปิดใช้ R2 ในแดชบอร์ด Cloudflare (ต้องผูกบัตร แต่มี free tier)

---

## ขั้นที่ 1 — ตั้งค่า VPS

```bash
# SSH เข้า server ในฐานะ root แล้วสร้าง user ใหม่ + ติดตั้ง docker
adduser deploy && usermod -aG sudo deploy
# ติดตั้ง Docker + compose plugin
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# firewall: เปิดเฉพาะ 22, 80, 443
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

> **อย่า** เปิด port 3306 (MySQL) หรือ 6379 (Redis) ออกสู่ public — ทั้งคู่อยู่ใน docker network ภายในพอ

---

## ขั้นที่ 2 — ตั้งค่า Cloudflare R2 (ไฟล์อัพโหลด)

1. Cloudflare Dashboard → R2 → **Create bucket** ชื่อ `staysync-uploads`
2. สร้าง bucket ที่สองสำหรับ backup: `staysync-backups`
3. R2 → **Manage R2 API Tokens** → สร้าง token แบบ *Object Read & Write* → เก็บ
   `Access Key ID` + `Secret Access Key`
4. หา **Account ID** (มุมขวาแดชบอร์ด) → endpoint จะเป็น
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
5. เปิด **public access** ให้ bucket `staysync-uploads`:
   - วิธีง่าย: R2 → bucket → Settings → **Public Development URL** (ได้ URL `https://pub-xxxx.r2.dev`)
   - วิธีโปร: ผูก **custom domain** `cdn.example.com` (R2 → Settings → Custom Domains)
   ค่าที่ได้นี้คือ `S3_PUBLIC_URL`

> ทำไม R2: **egress ฟรี** — เปิดดูรูป/สลิปไม่คิด bandwidth (S3 คิดแพง), แถม API เข้ากับ S3 SDK เลย

---

## ขั้นที่ 3 — DNS บน Cloudflare

เพิ่ม A record ชี้ไป IP ของ VPS (เปิด proxy สีส้มได้ทั้งคู่):

```
A   app   <VPS_IP>   (Proxied)   # frontend
A   api   <VPS_IP>   (Proxied)   # backend
# ถ้าใช้ custom domain ของ R2:
CNAME cdn  <R2 public hostname>  (Proxied)
```

SSL/TLS mode บน Cloudflare ตั้งเป็น **Full (strict)** — Caddy บน VPS จะมี cert ของจริงอยู่แล้ว

---

## ขั้นที่ 4 — Deploy stack

```bash
# บน VPS (user deploy)
mkdir -p ~/apps && cd ~/apps
git clone <FRONTEND_REPO_URL> owner-hotel-services
git clone <API_REPO_URL>      owner-hotel-services-api

# คัดลอก compose + env ตัวอย่างมาที่ ~/apps
cp owner-hotel-services-api/deploy/docker-compose.prod.yml ./docker-compose.prod.yml
cp owner-hotel-services-api/deploy/.env.prod.example       ./.env

# แก้ ~/apps/.env ใส่ค่าจริงทั้งหมด (โดเมน, รหัส, R2 keys)
#   JWT_SECRET   -> openssl rand -hex 64
#   ENCRYPTION_KEY -> openssl rand -hex 32
nano .env

# แก้โดเมนใน Caddyfile (app.example.com / api.example.com -> ของจริง)
nano owner-hotel-services-api/deploy/Caddyfile

# build + run
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

### รัน migration ครั้งแรก

```bash
# เข้า container api แล้ว deploy schema + seed (ถ้าต้องการ)
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec api npm run seed   # ถ้าต้องการข้อมูลตั้งต้น
```

เปิด `https://app.example.com` และ `https://api.example.com/api/v1/...` ได้เลย — Caddy ออก SSL อัตโนมัติภายในไม่กี่วินาที

---

## ขั้นที่ 5 — ตั้ง backup อัตโนมัติ

```bash
chmod +x owner-hotel-services-api/deploy/backup-db.sh
sudo mkdir -p /etc/staysync
sudo cp owner-hotel-services-api/deploy/backup.env.example /etc/staysync/backup.env
sudo nano /etc/staysync/backup.env       # ใส่ค่าจริง + chmod 600
sudo chmod 600 /etc/staysync/backup.env

# ติดตั้ง mysql-client + aws-cli
sudo apt-get update && sudo apt-get install -y mysql-client awscli

# cron ทุกวันตี 3
( crontab -l 2>/dev/null; echo "0 3 * * * set -a; . /etc/staysync/backup.env; set +a; $HOME/apps/owner-hotel-services-api/deploy/backup-db.sh >> /var/log/staysync-backup.log 2>&1" ) | crontab -
```

ทดสอบ restore ทุกเดือน — backup ที่กู้ไม่ได้ = ไม่มี backup

---

## การ Scale (เผื่อโต)

ระบบนี้ออกแบบให้ scale ได้ เพราะย้ายไฟล์ไป R2 แล้ว (stateless) แต่มี 3 จุดต้องจัดการเพิ่ม:

### 1. Socket.IO หลาย instance → ต้องมี Redis adapter
ตอนนี้ realtime ทำงานในแต่ละ instance แยกกัน พอมี api หลายตัวหลัง load balancer
event จะไม่ข้าม instance ต้องเพิ่ม:

```bash
npm install @socket.io/redis-adapter
```
แล้วผูก adapter เข้ากับ Socket.IO server โดยใช้ Redis ตัวที่มีอยู่แล้ว
(io.adapter(createAdapter(pubClient, subClient)))

### 2. Bull queue / cron ซ้ำ
`@nestjs/schedule` cron จะยิงทุก instance พร้อมกัน — แยก worker ออกเป็น process เดียว
หรือใช้ distributed lock (Redis SETNX) กันงานซ้ำ

### 3. เส้นทางขยาย
- **api:** เพิ่ม replica หลัง load balancer (Caddy/Cloudflare LB) — stateless แล้ว ทำได้เลย
- **MySQL:** ย้ายจาก container → Managed DB (DigitalOcean Managed MySQL ~$15/mo / PlanetScale)
  เพื่อได้ failover + auto-backup + read replica
- **Redis:** ย้ายไป Upstash / managed เมื่อ traffic สูง
- **frontend:** ย้ายไป Vercel ได้ถ้าอยากได้ edge CDN + preview deployments

ลำดับแนะนำ: เริ่ม VPS เดียว → แยก MySQL ออกเป็น managed ก่อน (จุดเสี่ยงสุด) → ค่อยเพิ่ม api replica

---

## Checklist ก่อน go-live

- [ ] `.env` มีค่าจริงครบ, `JWT_SECRET` 128 hex, `ENCRYPTION_KEY` 64 hex (ไม่ใช่ placeholder)
- [ ] `STORAGE_DRIVER=s3` + R2 credentials ครบ (api จะ refuse to start ถ้าขาด)
- [ ] ทดสอบอัพโหลดสลิป/รูป แล้วเปิด URL จาก R2 ได้จริง
- [ ] MySQL/Redis ไม่เปิด port ออก public, มีรหัสผ่าน
- [ ] `prisma migrate deploy` รันแล้ว
- [ ] Swagger ปิดบน production (NODE_ENV=production — ปิดให้อัตโนมัติแล้วใน main.ts)
- [ ] backup cron รันได้ + ทดสอบ restore สำเร็จ
- [ ] Cloudflare SSL = Full (strict), firewall เปิดแค่ 22/80/443
- [ ] ตั้ง VPS snapshot/backup รายวันใน panel ของ provider
```
