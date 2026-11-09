import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EncryptionService } from '../common/services/encryption.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { createTenantScopeMiddleware } from '../common/tenant/tenant-scope.middleware';

/**
 * PrismaService wraps PrismaClient.
 *
 * NOTE: The `declare` properties below bridge the gap between the current
 * Prisma schema and stale generated client types.  Models listed here were
 * added to `prisma/schema.prisma` after the last `prisma generate` run.
 * They exist at runtime (Prisma uses a proxy-based client), but TypeScript
 * does not know about them until you re-run `npx prisma generate`.
 *
 * TODO: After running `npx prisma generate` on the host machine, remove
 *       the manual `declare` properties below and the file
 *       `src/types/prisma-extensions.d.ts`.
 */

/**
 * Fields ที่ต้อง encrypt/decrypt อัตโนมัติ ตาม PDPA
 * Key = Prisma model name, Value = array of field names
 */
const SENSITIVE_FIELDS: Record<string, string[]> = {
  Guest: ['nationalId', 'passportNumber'],
  Employee: ['nationalId', 'bankAccount', 'socialSecurity', 'taxId'],
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Middleware registration order matters:
   *   1. Tenant scope FIRST — patches `where` / `data` with tenantId before
   *      any other middleware sees the args. This ensures encryption,
   *      validation, audit logging all operate on a tenant-correct payload.
   *   2. Encryption SECOND — encrypts/decrypts PDPA-sensitive fields after
   *      the tenant filter is in place.
   *
   * @param encryptionService - PDPA AES-256-GCM encryptor
   * @param tenantContext - AsyncLocalStorage-backed current-tenant accessor
   */
  constructor(
    private readonly encryptionService: EncryptionService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
    this._registerTenantScopeMiddleware();
    this._registerEncryptionMiddleware();
  }

  /**
   * Auto-inject `tenantId` into every query on tenant-scoped models.
   * Implementation lives in `common/tenant/tenant-scope.middleware.ts`
   * so the logic can be unit-tested in isolation.
   */
  private _registerTenantScopeMiddleware(): void {
    this.$use(createTenantScopeMiddleware(this.tenantContext));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Prisma Middleware: auto-encrypt ก่อน save, auto-decrypt หลัง read
   * ทำงานกับ model ที่อยู่ใน SENSITIVE_FIELDS เท่านั้น
   */
  private _registerEncryptionMiddleware() {
    this.$use(async (params, next) => {
      const fields = params.model ? SENSITIVE_FIELDS[params.model] : undefined;

      // ── ENCRYPT ก่อน write ──
      if (fields && ['create', 'update', 'upsert'].includes(params.action)) {
        const data =
          params.action === 'upsert'
            ? { ...params.args.create, ...params.args.update }
            : params.args.data;

        if (data && typeof data === 'object') {
          for (const field of fields) {
            if (data[field] != null) {
              data[field] = this.encryptionService.encrypt(data[field] as string);
            }
          }
        }
      }

      const result = await next(params);

      // ── DECRYPT หลัง read ──
      if (fields && result) {
        if (Array.isArray(result)) {
          result.forEach((row) => this._decryptRow(row, fields));
        } else if (typeof result === 'object') {
          this._decryptRow(result, fields);
        }
      }

      return result;
    });
  }

  private _decryptRow(row: Record<string, unknown>, fields: string[]) {
    for (const field of fields) {
      if (row[field] != null) {
        row[field] = this.encryptionService.decrypt(row[field] as string);
      }
    }
  }
}
