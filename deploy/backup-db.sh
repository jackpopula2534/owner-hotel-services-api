#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-db.sh — dump MySQL ของ StaySync แล้วอัพขึ้น Cloudflare R2 (หรือ S3)
#
# ออกแบบให้รันผ่าน cron บน VPS (ดู crontab ตัวอย่างท้ายไฟล์)
# ต้องมี: mysqldump (mysql-client), aws-cli v2, gzip
#
# ใช้ aws-cli กับ R2 ได้ผ่าน --endpoint-url ของ R2
# ตั้งค่า credentials ผ่าน env หรือ ~/.aws/credentials (profile)
#
# ENV ที่ต้องตั้ง (เช่นใน /etc/staysync/backup.env แล้ว `set -a; source ...; set +a`):
#   DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
#   R2_BUCKET            เช่น staysync-backups
#   R2_ENDPOINT          เช่น https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID    R2 access key
#   AWS_SECRET_ACCESS_KEY R2 secret key
#   AWS_DEFAULT_REGION   auto
#   RETENTION_DAYS       (optional) ลบ backup เก่ากว่า N วันบน R2 (default 30)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
FILENAME="staysync-${DB_DATABASE}-${TIMESTAMP}.sql.gz"
TMP_FILE="/tmp/${FILENAME}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cleanup() { rm -f "${TMP_FILE}"; }
trap cleanup EXIT

# ── 1) dump + gzip ──
log "Dumping ${DB_DATABASE} from ${DB_HOST}:${DB_PORT:-3306} ..."
mysqldump \
	--host="${DB_HOST}" \
	--port="${DB_PORT:-3306}" \
	--user="${DB_USERNAME}" \
	--password="${DB_PASSWORD}" \
	--single-transaction \
	--quick \
	--routines \
	--triggers \
	--events \
	--default-character-set=utf8mb4 \
	"${DB_DATABASE}" | gzip -9 > "${TMP_FILE}"

SIZE="$(du -h "${TMP_FILE}" | cut -f1)"
log "Dump created: ${TMP_FILE} (${SIZE})"

# ── 2) upload ขึ้น R2 ──
S3_URI="s3://${R2_BUCKET}/db/${FILENAME}"
log "Uploading to ${S3_URI} ..."
aws s3 cp "${TMP_FILE}" "${S3_URI}" \
	--endpoint-url "${R2_ENDPOINT}" \
	--only-show-errors
log "Upload OK."

# ── 3) ลบ backup เก่าบน R2 (retention) ──
log "Pruning backups older than ${RETENTION_DAYS} days ..."
CUTOFF="$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-"${RETENTION_DAYS}"d +%Y-%m-%d)"
aws s3 ls "s3://${R2_BUCKET}/db/" --endpoint-url "${R2_ENDPOINT}" | while read -r line; do
	FILE_DATE="$(echo "${line}" | awk '{print $1}')"
	FILE_NAME="$(echo "${line}" | awk '{print $4}')"
	[ -z "${FILE_NAME}" ] && continue
	if [[ "${FILE_DATE}" < "${CUTOFF}" ]]; then
		log "  deleting old backup: ${FILE_NAME}"
		aws s3 rm "s3://${R2_BUCKET}/db/${FILE_NAME}" --endpoint-url "${R2_ENDPOINT}" --only-show-errors
	fi
done

log "Backup complete ✓"

# ─────────────────────────────────────────────────────────────────────────────
# ติดตั้งเป็น cron (ทุกวันตี 3):
#   chmod +x deploy/backup-db.sh
#   sudo mkdir -p /etc/staysync && sudo cp deploy/backup.env.example /etc/staysync/backup.env
#   sudo crontab -e
#     0 3 * * * set -a; . /etc/staysync/backup.env; set +a; /path/to/backup-db.sh >> /var/log/staysync-backup.log 2>&1
#
# ทดสอบกู้คืน (restore):
#   aws s3 cp s3://staysync-backups/db/<FILE>.sql.gz . --endpoint-url $R2_ENDPOINT
#   gunzip -c <FILE>.sql.gz | mysql -h $DB_HOST -u $DB_USERNAME -p $DB_DATABASE
# ─────────────────────────────────────────────────────────────────────────────
