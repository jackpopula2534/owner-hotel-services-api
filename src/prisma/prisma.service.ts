import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
