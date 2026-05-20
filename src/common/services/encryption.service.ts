import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * EncryptionService — AES-256-GCM symmetric encryption
 *
 * ใช้สำหรับเข้ารหัสข้อมูลส่วนบุคคลอ่อนไหวก่อนบันทึกลง database
 * เช่น nationalId, passportNumber, bankAccount, socialSecurity, taxId
 *
 * Format: base64(IV[12] || AuthTag[16] || CipherText)
 *
 * Environment variable ที่ต้องตั้ง:
 *   ENCRYPTION_KEY=<64 hex chars = 32 bytes>
 *   สร้างด้วย: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 12; // bytes — recommended for GCM
  private readonly TAG_LENGTH = 16; // bytes — GCM auth tag

  // Sentinel prefix — ใช้ตรวจว่า value เข้ารหัสแล้วหรือยัง
  private readonly ENC_PREFIX = 'enc:';

  constructor(private readonly config: ConfigService) {
    const keyHex = this.config.get<string>('ENCRYPTION_KEY');
    if (!keyHex || keyHex.length !== 64) {
      this.logger.warn(
        'ENCRYPTION_KEY ไม่ถูกต้องหรือไม่ได้ตั้งค่า — ข้อมูล sensitive จะไม่ถูกเข้ารหัส!',
      );
      // ใช้ key ว่างแบบ mock เพื่อไม่ให้ app crash ใน dev (ต้องตั้งจริงใน prod)
      this.key = Buffer.alloc(32, 0);
    } else {
      this.key = Buffer.from(keyHex, 'hex');
    }
  }

  /**
   * เข้ารหัส plaintext ด้วย AES-256-GCM
   * คืนค่า base64 string พร้อม prefix "enc:"
   * ถ้า input เป็น null/undefined/empty คืนค่าเดิม
   */
  encrypt(plaintext: string | null | undefined): string | null | undefined {
    if (!plaintext) return plaintext;
    // ถ้าเข้ารหัสแล้วไม่ต้องทำซ้ำ
    if (plaintext.startsWith(this.ENC_PREFIX)) return plaintext;

    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // IV (12) + AuthTag (16) + CipherText
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return this.ENC_PREFIX + combined.toString('base64');
  }

  /**
   * ถอดรหัส ciphertext
   * ถ้า input ไม่ใช่ encrypted string คืนค่าเดิม (backward compatible)
   */
  decrypt(ciphertext: string | null | undefined): string | null | undefined {
    if (!ciphertext) return ciphertext;
    if (!ciphertext.startsWith(this.ENC_PREFIX)) {
      // Legacy plaintext — คืนค่าเดิม (graceful migration)
      return ciphertext;
    }

    const buf = Buffer.from(ciphertext.slice(this.ENC_PREFIX.length), 'base64');
    const iv = buf.subarray(0, this.IV_LENGTH);
    const authTag = buf.subarray(this.IV_LENGTH, this.IV_LENGTH + this.TAG_LENGTH);
    const encrypted = buf.subarray(this.IV_LENGTH + this.TAG_LENGTH);

    const decipher = createDecipheriv(this.ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  /**
   * Mask ค่า — แสดงเฉพาะ n ตัวท้าย แทนที่ส่วนที่เหลือด้วย *
   * ใช้สำหรับ API response ที่ต้องแสดงบางส่วน
   *
   * ตัวอย่าง: mask("1234567890123", 4) => "*********0123"
   */
  mask(value: string | null | undefined, showLast = 4): string {
    if (!value) return '';
    const plain = this.decrypt(value) as string;
    if (!plain || plain.length <= showLast) return '****';
    return plain.slice(0, -showLast).replace(/./g, '*') + plain.slice(-showLast);
  }

  /**
   * ตรวจว่าค่านี้ถูกเข้ารหัสแล้วหรือยัง
   */
  isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(this.ENC_PREFIX);
  }
}
