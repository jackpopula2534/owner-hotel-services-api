import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../../src/common/services/encryption.service';

/**
 * Unit tests — EncryptionService (AES-256-GCM)
 * S4-02 PDPA Test Coverage
 */

// key 32 bytes (64 hex chars) สำหรับ test
const TEST_KEY_HEX = 'a'.repeat(64);

function buildService(keyHex?: string): EncryptionService {
  const configGet = jest.fn().mockReturnValue(keyHex ?? TEST_KEY_HEX);
  const configService = { get: configGet } as unknown as ConfigService;
  return new EncryptionService(configService);
}

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    service = buildService();
  });

  // ──────────────────────────────────────────────────────────────
  // encrypt()
  // ──────────────────────────────────────────────────────────────
  describe('encrypt()', () => {
    it('should return a string starting with "enc:" prefix', () => {
      const result = service.encrypt('hello-world');
      expect(result).toMatch(/^enc:/);
    });

    it('should produce different ciphertext each call (random IV)', () => {
      const a = service.encrypt('same-value');
      const b = service.encrypt('same-value');
      expect(a).not.toBe(b);
    });

    it('should return null when input is null', () => {
      expect(service.encrypt(null)).toBeNull();
    });

    it('should return undefined when input is undefined', () => {
      expect(service.encrypt(undefined)).toBeUndefined();
    });

    it('should return empty string when input is empty string', () => {
      expect(service.encrypt('')).toBe('');
    });

    it('should NOT re-encrypt already encrypted values (idempotent)', () => {
      const first = service.encrypt('sensitive-data') as string;
      const second = service.encrypt(first);
      expect(second).toBe(first); // คืนค่าเดิมโดยไม่เข้ารหัสซ้ำ
    });

    it('should handle Thai characters', () => {
      const result = service.encrypt('ข้อมูลส่วนตัว');
      expect(result).toMatch(/^enc:/);
      const decrypted = service.decrypt(result);
      expect(decrypted).toBe('ข้อมูลส่วนตัว');
    });

    it('should handle long strings (passport, bankAccount)', () => {
      const longValue = 'TH' + '9'.repeat(30);
      const encrypted = service.encrypt(longValue);
      expect(service.decrypt(encrypted)).toBe(longValue);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // decrypt()
  // ──────────────────────────────────────────────────────────────
  describe('decrypt()', () => {
    it('should decrypt encrypted value back to plaintext', () => {
      const plain = '1234567890123';
      const encrypted = service.encrypt(plain) as string;
      expect(service.decrypt(encrypted)).toBe(plain);
    });

    it('should return null when input is null', () => {
      expect(service.decrypt(null)).toBeNull();
    });

    it('should return undefined when input is undefined', () => {
      expect(service.decrypt(undefined)).toBeUndefined();
    });

    it('should return empty string as-is', () => {
      expect(service.decrypt('')).toBe('');
    });

    it('should return legacy plaintext as-is (backward compatibility)', () => {
      const legacy = 'plaintext-national-id';
      // ค่าที่ไม่ได้เข้ารหัส (legacy) ควรคืนค่าเดิม
      expect(service.decrypt(legacy)).toBe(legacy);
    });

    it('should be the inverse of encrypt for various inputs', () => {
      const testCases = [
        'TH123456789',        // passport
        '1234567890123',      // national id (13 digits)
        'SCB-0012345678',     // bank account
        '1234567-1-23-4',     // social security
        'taxid-1234567890',   // tax id
      ];

      for (const value of testCases) {
        const encrypted = service.encrypt(value) as string;
        expect(service.decrypt(encrypted)).toBe(value);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // mask()
  // ──────────────────────────────────────────────────────────────
  describe('mask()', () => {
    it('should mask plaintext keeping last 4 chars', () => {
      const plain = '1234567890123';
      const result = service.mask(plain);
      expect(result).toBe('*********0123');
    });

    it('should mask encrypted value correctly', () => {
      const plain = '1234567890123';
      const encrypted = service.encrypt(plain) as string;
      const result = service.mask(encrypted);
      expect(result).toBe('*********0123');
    });

    it('should return empty string when input is null', () => {
      expect(service.mask(null)).toBe('');
    });

    it('should return empty string when input is undefined', () => {
      expect(service.mask(undefined)).toBe('');
    });

    it('should return "****" when value is shorter than showLast', () => {
      expect(service.mask('123', 4)).toBe('****');
    });

    it('should respect custom showLast parameter', () => {
      const result = service.mask('ABCDEFGHIJ', 2);
      expect(result).toBe('********IJ');
    });

    it('should handle string exactly equal to showLast length', () => {
      expect(service.mask('1234', 4)).toBe('****');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // isEncrypted()
  // ──────────────────────────────────────────────────────────────
  describe('isEncrypted()', () => {
    it('should return true for encrypted values', () => {
      const encrypted = service.encrypt('sensitive') as string;
      expect(service.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext', () => {
      expect(service.isEncrypted('plain-text')).toBe(false);
    });

    it('should return false for null', () => {
      expect(service.isEncrypted(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(service.isEncrypted(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(service.isEncrypted('')).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Invalid / missing key handling
  // ──────────────────────────────────────────────────────────────
  describe('invalid ENCRYPTION_KEY', () => {
    it('should not crash when key is missing (falls back to zero key)', () => {
      const noKeyService = buildService(undefined);
      // ไม่ crash และ encrypt/decrypt ยังทำงานได้ (ด้วย zero key)
      const enc = noKeyService.encrypt('test');
      expect(enc).toMatch(/^enc:/);
      expect(noKeyService.decrypt(enc)).toBe('test');
    });

    it('should not crash when key is wrong length (falls back to zero key)', () => {
      const badKeyService = buildService('tooshort');
      const enc = badKeyService.encrypt('data');
      expect(enc).toMatch(/^enc:/);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // NestJS DI integration
  // ──────────────────────────────────────────────────────────────
  describe('NestJS module integration', () => {
    it('should be defined when provided via TestingModule', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EncryptionService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(TEST_KEY_HEX) },
          },
        ],
      }).compile();

      const svc = module.get<EncryptionService>(EncryptionService);
      expect(svc).toBeDefined();
    });
  });
});
