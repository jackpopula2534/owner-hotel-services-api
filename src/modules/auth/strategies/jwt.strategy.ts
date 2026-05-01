import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    if (!payload) {
      throw new UnauthorizedException();
    }

    // ── Live status check ──────────────────────────────────────────────────────
    // เฉพาะ token ที่เป็น user (ไม่ใช่ admin) และไม่ใช่ platform admin
    // ดึง user สดเพื่อเช็ค status / expiresAt — ปิดประตูให้ user ที่ถูก suspend
    // ระหว่าง session ใช้งานต่อไม่ได้แม้ token ยังไม่หมด
    if (payload.sub && !payload.isPlatformAdmin) {
      try {
        // as unknown: Prisma type อาจยังไม่ sync หลัง schema migration
        const user = (await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, status: true, expiresAt: true } as any,
        })) as unknown as { id: string; status: string; expiresAt: Date | null } | null;

        if (!user) {
          throw new UnauthorizedException('User not found');
        }

        if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
          throw new UnauthorizedException('บัญชีของคุณหมดอายุการใช้งาน');
        }

        if (user.status !== 'active') {
          const msg =
            user.status === 'suspended'
              ? 'บัญชีของคุณถูกระงับการใช้งาน'
              : user.status === 'expired'
                ? 'บัญชีของคุณหมดอายุการใช้งาน'
                : user.status === 'inactive'
                  ? 'บัญชีของคุณถูกปิดการใช้งาน'
                  : 'บัญชีของคุณไม่อยู่ในสถานะใช้งาน';
          throw new UnauthorizedException(msg);
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        // DB error — log แล้วปล่อย token ผ่าน (ไม่ทำให้ระบบล่มทั้งระบบ)
        this.logger.warn(
          `JwtStrategy live status check failed for user ${payload.sub}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    return {
      id: payload.sub,
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId ?? undefined,
      isPlatformAdmin: payload.isPlatformAdmin ?? false,
    };
  }
}
