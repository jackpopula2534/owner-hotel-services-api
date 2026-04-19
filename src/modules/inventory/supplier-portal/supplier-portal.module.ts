import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmailModule } from '@/email/email.module';
import { SupplierPortalService } from './supplier-portal.service';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierQuotesModule } from '../supplier-quotes/supplier-quotes.module';

/**
 * SupplierPortalModule wires the public (unauthenticated) supplier portal.
 *
 * Exposes:
 *   - GET  /v1/supplier-portal/session?token=...
 *   - POST /v1/supplier-portal/submit?token=...
 *
 * The service layer (SupplierPortalService) is also consumed by RfqsModule
 * and admin-side endpoints for token generation / revocation, so it is
 * exported.
 *
 * Circular dependency note: there is a 3-module cycle:
 *   SupplierPortalModule → SupplierQuotesModule → RfqsModule → SupplierPortalModule
 * We break it by forward-ref'ing BOTH edges of the cycle where SupplierPortal
 * sits: the Portal↔Quotes edge below, and the Rfqs↔Portal edge in
 * rfqs.module.ts. The controller uses SupplierQuotesService via
 * forwardRef(() => ...) in its constructor to match.
 */
@Module({
  imports: [PrismaModule, ConfigModule, EmailModule, forwardRef(() => SupplierQuotesModule)],
  controllers: [SupplierPortalController],
  providers: [SupplierPortalService],
  exports: [SupplierPortalService],
})
export class SupplierPortalModule {}
