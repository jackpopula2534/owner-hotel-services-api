import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertEmployeeCodeConfigDto } from './dto/employee-code-config.dto';

@Injectable()
export class EmployeeCodeConfigService {
  private readonly logger = new Logger(EmployeeCodeConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get the employee code configuration for a tenant.
   * Returns null if not configured yet.
   */
  async getConfig(tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const config = await (this.prisma as any).employeeCodeConfig.findUnique({
      where: { tenantId },
    });

    return config ?? this.getDefaultConfig(tenantId);
  }

  /**
   * Create or update the employee code configuration for a tenant.
   * Uses upsert to simplify the API — single endpoint for both create and update.
   */
  async upsertConfig(tenantId: string, dto: UpsertEmployeeCodeConfigDto) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    this.validatePattern(dto.pattern);

    const sampleOutput = this.buildSampleCode(dto);

    const data = {
      pattern: dto.pattern,
      prefix: dto.prefix.toUpperCase(),
      separator: dto.separator ?? '-',
      digitLength: dto.digitLength ?? 4,
      resetCycle: dto.resetCycle ?? 'NEVER',
      includeYear: dto.includeYear ?? false,
      yearFormat: dto.yearFormat ?? 'YYYY',
      includeDept: dto.includeDept ?? false,
      deptSource: dto.deptSource ?? 'CODE',
      isActive: dto.isActive ?? true,
      sampleOutput,
    };

    const config = await (this.prisma as any).employeeCodeConfig.upsert({
      where: { tenantId },
      create: { ...data, tenantId, nextNumber: 1 },
      update: data,
    });

    this.logger.log(`Employee code config upserted for tenant ${tenantId}: ${config.pattern}`);

    return config;
  }

  /**
   * Generate the next available employee code, unique within the same (tenantId, propertyId).
   *
   * Uniqueness rule: an employeeCode must not collide with any existing employee that shares
   * BOTH the same tenantId AND the same propertyId (hotel). The same code may appear in
   * different hotels of the same tenant — this is intentional.
   *
   * Flow:
   *  1. Atomically fetch & increment the running counter (inside a DB transaction).
   *  2. Build the candidate code from the configured pattern.
   *  3. Check the employees table for a collision scoped to (tenantId, propertyId).
   *  4. If colliding, advance the counter and retry (up to MAX_ATTEMPTS times).
   *
   * @param tenantId      - Tenant scope
   * @param departmentCode - Optional dept code to embed in the pattern
   * @param propertyId    - Hotel/property scope for collision detection (nullable — if null, only tenantId is used)
   */
  async generateNextCode(
    tenantId: string,
    departmentCode?: string,
    propertyId?: string,
  ): Promise<string> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const MAX_ATTEMPTS = 50;

    return this.prisma.$transaction(async (tx: any) => {
      let config = await tx.employeeCodeConfig.findUnique({ where: { tenantId } });

      if (!config) {
        config = await tx.employeeCodeConfig.create({
          data: {
            tenantId,
            pattern: '{PREFIX}-{NNNN}',
            prefix: 'EMP',
            separator: '-',
            digitLength: 4,
            resetCycle: 'NEVER',
            nextNumber: 1,
            includeYear: false,
            yearFormat: 'YYYY',
            includeDept: false,
            deptSource: 'CODE',
            isActive: true,
          },
        });
      }

      const shouldReset = this.shouldResetCounter(config);
      const configNumber = shouldReset ? 1 : config.nextNumber;

      // ─── Sync with actual DB ──────────────────────────────────────────────
      // config.nextNumber อาจล้าหลังกว่าข้อมูลจริงในตาราง employees
      // (เช่น มีการ import/seed ข้อมูลโดยไม่ผ่าน generateNextCode)
      // จึงต้อง scan หา running number สูงสุดที่ใช้งานจริง แล้วเริ่มต่อจากนั้น
      const existingEmployees = await tx.employee.findMany({
        where: {
          tenantId,
          ...(propertyId ? { propertyId } : {}),
          employeeCode: { not: null },
        },
        select: { employeeCode: true },
      });

      let maxFoundNumber = 0;
      for (const emp of existingEmployees) {
        if (!emp.employeeCode) continue;
        // ดึงตัวเลข suffix ท้ายสุดจาก code เช่น "EMP-0003" → 3, "HR-2026-005" → 5
        const match = (emp.employeeCode as string).match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxFoundNumber) maxFoundNumber = num;
        }
      }

      // เริ่มจากตัวที่สูงกว่าระหว่าง config กับของจริงใน DB
      let currentNumber = Math.max(configNumber, maxFoundNumber + 1);

      if (maxFoundNumber > 0) {
        this.logger.log(
          `Synced running number: config=${configNumber}, maxInDB=${maxFoundNumber} → starting from ${currentNumber} (tenant ${tenantId} / property ${propertyId ?? 'any'})`,
        );
      }

      let code: string;
      let attempts = 0;

      do {
        if (attempts >= MAX_ATTEMPTS) {
          this.logger.error(
            `generateNextCode exceeded ${MAX_ATTEMPTS} attempts for tenant ${tenantId} property ${propertyId ?? 'any'} — counter severely out of sync`,
          );
          throw new BadRequestException(
            'ไม่สามารถสร้างรหัสพนักงานอัตโนมัติได้ กรุณาระบุรหัสพนักงานด้วยตนเอง',
          );
        }

        code = this.buildCodeFromPattern({
          pattern: config.pattern,
          prefix: config.prefix,
          separator: config.separator,
          digitLength: config.digitLength,
          yearFormat: config.yearFormat,
          departmentCode: departmentCode ?? '',
          runningNumber: currentNumber,
        });

        // Scope collision check to (tenantId, propertyId) — mirrors the DB unique constraint
        const existingWhere: Record<string, unknown> = { tenantId, employeeCode: code };
        if (propertyId) existingWhere.propertyId = propertyId;

        const existing = await tx.employee.findFirst({
          where: existingWhere,
          select: { id: true },
        });

        if (!existing) break;

        this.logger.warn(
          `Code "${code}" already used in tenant ${tenantId} / property ${propertyId ?? 'any'} — trying next (attempt ${attempts + 1})`,
        );
        currentNumber += 1;
        attempts += 1;
      } while (true);

      // บันทึก nextNumber เป็น currentNumber+1 เสมอ (ครอบคลุมกรณี sync กับ DB แล้ว)
      await tx.employeeCodeConfig.update({
        where: { tenantId },
        data: {
          nextNumber: currentNumber + 1,
          ...(shouldReset ? { lastResetDate: new Date() } : {}),
        },
      });

      this.logger.log(
        `Employee code "${code}" generated for tenant ${tenantId} / property ${propertyId ?? 'any'} (attempts: ${attempts + 1})`,
      );

      return code;
    });
  }

  /**
   * Preview what the next code would look like without actually incrementing.
   *
   * IMPORTANT: syncs with existing employees in DB to avoid showing a stale
   * preview that would collide on actual creation. This mirrors the logic in
   * generateNextCode() but does NOT update the counter — it is read-only.
   *
   * @param propertyId - Optional hotel/property scope for accurate sync
   */
  async previewNextCode(
    tenantId: string,
    departmentCode?: string,
    propertyId?: string,
  ): Promise<string> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const config = await (this.prisma as any).employeeCodeConfig.findUnique({
      where: { tenantId },
    });

    const effectiveConfig = config ?? {
      pattern: '{PREFIX}-{NNNN}',
      prefix: 'EMP',
      separator: '-',
      digitLength: 4,
      yearFormat: 'YYYY',
      resetCycle: 'NEVER',
      nextNumber: 1,
      lastResetDate: null,
    };

    const shouldReset = this.shouldResetCounter(effectiveConfig);
    const configNumber = shouldReset ? 1 : effectiveConfig.nextNumber;

    // ─── Sync with actual DB (read-only) ────────────────────────────────
    // ดึง running number สูงสุดจาก employees จริงเพื่อ preview ที่ถูกต้อง
    const existingEmployees = await (this.prisma as any).employee.findMany({
      where: {
        tenantId,
        ...(propertyId ? { propertyId } : {}),
        employeeCode: { not: null },
      },
      select: { employeeCode: true },
    });

    let maxFoundNumber = 0;
    for (const emp of existingEmployees) {
      if (!emp.employeeCode) continue;
      const match = (emp.employeeCode as string).match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxFoundNumber) maxFoundNumber = num;
      }
    }

    const currentNumber = Math.max(configNumber, maxFoundNumber + 1);

    return this.buildCodeFromPattern({
      pattern: effectiveConfig.pattern,
      prefix: effectiveConfig.prefix,
      separator: effectiveConfig.separator,
      digitLength: effectiveConfig.digitLength,
      yearFormat: effectiveConfig.yearFormat,
      departmentCode: departmentCode ?? 'HR',
      runningNumber: currentNumber,
    });
  }

  /**
   * Reset the running number counter to 1.
   */
  async resetCounter(tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const config = await (this.prisma as any).employeeCodeConfig.update({
      where: { tenantId },
      data: {
        nextNumber: 1,
        lastResetDate: new Date(),
      },
    });

    this.logger.log(`Employee code counter reset for tenant ${tenantId}`);

    return config;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private getDefaultConfig(tenantId: string) {
    return {
      id: null,
      tenantId,
      pattern: '{PREFIX}-{NNNN}',
      prefix: 'EMP',
      separator: '-',
      digitLength: 4,
      resetCycle: 'NEVER',
      nextNumber: 1,
      lastResetDate: null,
      includeYear: false,
      yearFormat: 'YYYY',
      includeDept: false,
      deptSource: 'CODE',
      isActive: true,
      sampleOutput: 'EMP-0001',
      isDefault: true,
    };
  }

  private validatePattern(pattern: string): void {
    const validPlaceholders = [
      '{PREFIX}',
      '{DEPT}',
      '{YYYY}',
      '{YY}',
      '{MM}',
      '{NNNN}',
      '{NNN}',
      '{NN}',
      '{N}',
    ];
    const placeholders = pattern.match(/\{[A-Z]+\}/g) || [];

    for (const ph of placeholders) {
      if (!validPlaceholders.includes(ph)) {
        throw new BadRequestException(
          `Invalid placeholder "${ph}" in pattern. Valid: ${validPlaceholders.join(', ')}`,
        );
      }
    }

    // Must contain at least a running number placeholder
    const hasRunning = placeholders.some((ph) => ['{NNNN}', '{NNN}', '{NN}', '{N}'].includes(ph));
    if (!hasRunning) {
      throw new BadRequestException(
        'Pattern must include a running number placeholder ({N}, {NN}, {NNN}, or {NNNN})',
      );
    }
  }

  private buildSampleCode(dto: UpsertEmployeeCodeConfigDto): string {
    return this.buildCodeFromPattern({
      pattern: dto.pattern,
      prefix: dto.prefix.toUpperCase(),
      separator: dto.separator ?? '-',
      digitLength: dto.digitLength ?? 4,
      yearFormat: dto.yearFormat ?? 'YYYY',
      departmentCode: 'HR',
      runningNumber: 1,
    });
  }

  private buildCodeFromPattern(params: {
    pattern: string;
    prefix: string;
    separator: string;
    digitLength: number;
    yearFormat: string;
    departmentCode: string;
    runningNumber: number;
  }): string {
    const { pattern, prefix, separator, digitLength, yearFormat, departmentCode, runningNumber } =
      params;
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const yy = yyyy.slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');

    let code = pattern;

    // Replace placeholders
    code = code.replace(/\{PREFIX\}/g, prefix);
    code = code.replace(/\{DEPT\}/g, departmentCode.toUpperCase());
    code = code.replace(/\{YYYY\}/g, yyyy);
    code = code.replace(/\{YY\}/g, yy);
    code = code.replace(/\{MM\}/g, mm);

    // Replace running number with proper digit padding
    code = code.replace(/\{NNNN\}/g, runningNumber.toString().padStart(digitLength, '0'));
    code = code.replace(/\{NNN\}/g, runningNumber.toString().padStart(3, '0'));
    code = code.replace(/\{NN\}/g, runningNumber.toString().padStart(2, '0'));
    code = code.replace(/\{N\}/g, runningNumber.toString());

    // Replace separator placeholders (dashes in pattern are kept as-is)
    // The separators in the pattern are literal characters entered by user

    return code;
  }

  private shouldResetCounter(config: { resetCycle: string; lastResetDate: Date | null }): boolean {
    if (config.resetCycle === 'NEVER') return false;
    if (!config.lastResetDate) return false;

    const now = new Date();
    const lastReset = new Date(config.lastResetDate);

    if (config.resetCycle === 'YEARLY') {
      return now.getFullYear() > lastReset.getFullYear();
    }

    if (config.resetCycle === 'MONTHLY') {
      return (
        now.getFullYear() > lastReset.getFullYear() ||
        (now.getFullYear() === lastReset.getFullYear() && now.getMonth() > lastReset.getMonth())
      );
    }

    return false;
  }
}
