import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type ApiKeyScope =
  | 'read:bookings'
  | 'write:bookings'
  | 'read:rooms'
  | 'write:rooms'
  | 'read:guests'
  | 'admin';

export interface CreateApiKeyInput {
  tenantId: string;
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string; // ISO; null = never
  createdBy?: string;
}

export interface CreatedKey {
  id: string;
  name: string;
  prefix: string;
  /** Plain text key — shown ONCE at creation time. Caller must store it. */
  plaintext: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly PREFIX = 'ssk_'; // staysync key

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a fresh API key. Returns the plaintext to caller — server
   * keeps only the SHA-256 hash. The 8-char prefix is also stored so
   * users can identify keys in lists without exposing the secret.
   */
  async create(input: CreateApiKeyInput): Promise<CreatedKey> {
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    if (!input.scopes?.length) throw new BadRequestException('at least one scope is required');

    const secret = randomBytes(32).toString('base64url'); // ~43 chars
    const plaintext = `${this.PREFIX}${secret}`;
    const prefix = plaintext.slice(0, 12);
    const keyHash = this.hash(plaintext);

    const row = await (this.prisma as any).api_keys.create({
      data: {
        tenant_id: input.tenantId,
        name: input.name.trim(),
        key_prefix: prefix,
        key_hash: keyHash,
        scopes: input.scopes,
        expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
        created_by: input.createdBy,
      },
    });

    this.logger.log(`API key created: tenant=${input.tenantId} prefix=${prefix}`);

    return {
      id: row.id,
      name: row.name,
      prefix,
      plaintext,
      scopes: input.scopes,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    };
  }

  async list(tenantId: string) {
    const keys = await (this.prisma as any).api_keys.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    // Strip the hash from public-facing list
    return keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      prefix: k.key_prefix,
      scopes: k.scopes,
      isActive: k.is_active === 1,
      lastUsedAt: k.last_used_at,
      expiresAt: k.expires_at,
      revokedAt: k.revoked_at,
      createdAt: k.created_at,
    }));
  }

  async revoke(keyId: string, tenantId: string): Promise<void> {
    const k = await (this.prisma as any).api_keys.findUnique({ where: { id: keyId } });
    if (!k) throw new NotFoundException('API key not found');
    if (k.tenant_id !== tenantId) {
      throw new ForbiddenException("Cannot revoke another tenant's key");
    }
    if (k.revoked_at) return; // idempotent
    await (this.prisma as any).api_keys.update({
      where: { id: keyId },
      data: { is_active: 0, revoked_at: new Date() },
    });
  }

  /**
   * Verify a presented plaintext key. Used by an `ApiKeyAuthGuard`
   * (caller's responsibility) on protected endpoints.
   */
  async verify(plaintext: string): Promise<{
    keyId: string;
    tenantId: string;
    scopes: ApiKeyScope[];
  } | null> {
    if (!plaintext?.startsWith(this.PREFIX)) return null;
    const keyHash = this.hash(plaintext);
    const row = await (this.prisma as any).api_keys.findUnique({
      where: { key_hash: keyHash },
    });
    if (!row || row.is_active !== 1 || row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

    // Record last-used timestamp asynchronously (best-effort).
    void (this.prisma as any).api_keys
      .update({
        where: { id: row.id },
        data: { last_used_at: new Date() },
      })
      .catch(() => {});

    return {
      keyId: row.id,
      tenantId: row.tenant_id,
      scopes: row.scopes as ApiKeyScope[],
    };
  }

  hash(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }
}
