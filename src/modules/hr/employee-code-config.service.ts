import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
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
   * Generate the next employee code based on the tenant's configuration.
   * Atomically increments the running number.
   *
   * @param tenantId - The tenant ID
   * @param departmentCode - Optional department code to include in the generated code
   * @returns The generated employee code string
   */
  async generateNextCode(tenantId: string, departmentCode?: string): Promise<string> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Use a transaction to ensure atomic read-and-increment
    return this.prisma.$transaction(async (tx: any) => {
      let config = await tx.employeeCodeConfig.findUnique({
        where: { tenantId },
      });

      // If no config exists, use default pattern
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

      // Check if we need to reset the counter
      const shouldReset = this.shouldResetCounter(config);
      let currentNumber = shouldReset ? 1 : config.nextNumber;

      // Build the code from pattern
      const code = this.buildCodeFromPattern({
        pattern: config.pattern,
        prefix: config.prefix,
        separator: config.separator,
        digitLength: config.digitLength,
        yearFormat: config.yearFormat,
        departmentCode: departmentCode ?? '',
        runningNumber: currentNumber,
      });

      // Increment the counter (or reset it)
      await tx.employeeCodeConfig.update({
        where: { tenantId },
        data: {
          nextNumber: currentNumber + 1,
          ...(shouldReset ? { lastResetDate: new Date() } : {}),
        },
      });

      this.logger.log(`Generated employee code for tenant ${tenantId}: ${code}`);

      return code;
    });
  }

  /**
   * Preview what the next code would look like without actually incrementing.
   */
  async previewNextCode(tenantId: string, departmentCode?: string): Promise<string> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const config = await (this.prisma as any).employeeCodeConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      return this.buildCodeFromPattern({
        pattern: '{PREFIX}-{NNNN}',
        prefix: 'EMP',
        separator: '-',
        digitLength: 4,
        yearFormat: 'YYYY',
        departmentCode: departmentCode ?? 'HR',
        runningNumber: 1,
      });
    }

    const shouldReset = this.shouldResetCounter(config);
    const currentNumber = shouldReset ? 1 : config.nextNumber;

    return this.buildCodeFromPattern({
      pattern: config.pattern,
      prefix: config.prefix,
      separator: config.separator,
      digitLength: config.digitLength,
      yearFormat: config.yearFormat,
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
    const validPlaceholders = ['{PREFIX}', '{DEPT}', '{YYYY}', '{YY}', '{MM}', '{NNNN}', '{NNN}', '{NN}', '{N}'];
    const placeholders = pattern.match(/\{[A-Z]+\}/g) || [];

    for (const ph of placeholders) {
      if (!validPlaceholders.includes(ph)) {
        throw new BadRequestException(
          `Invalid placeholder "${ph}" in pattern. Valid: ${validPlaceholders.join(', ')}`,
        );
      }
    }

    // Must contain at least a running number placeholder
    const hasRunning = placeholders.some((ph) =>
      ['{NNNN}', '{NNN}', '{NN}', '{N}'].includes(ph),
    );
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
    const { pattern, prefix, separator, digitLength, yearFormat, departmentCode, runningNumber } = params;
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

  private shouldResetCounter(config: {
    resetCycle: string;
    lastResetDate: Date | null;
  }): boolean {
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
