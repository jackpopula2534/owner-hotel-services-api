import { Module } from '@nestjs/common';
import { RevenuePostingService } from './revenue-posting.service';
import { RevenueQueryService } from './revenue-query.service';

/**
 * Provider-only module, on purpose.
 *
 * The four modules that earn money (restaurant, inventory/retail, bookings,
 * camp) all have to import this to record a sale. Any controller or accounting
 * dependency added here would be dragged into every one of them — and the
 * accounting add-on is exactly what the revenue ledger must not depend on, or
 * tenants who never bought it would stop recording revenue at all.
 *
 * `RevenueQueryService` is the read half: every screen that prints a "รายได้"
 * figure imports this module and asks it, instead of counting source rows for
 * itself. It carries no extra dependency — same PrismaService as the writer —
 * so a reporting module importing this still pulls nothing it did not ask for.
 */
@Module({
  providers: [RevenuePostingService, RevenueQueryService],
  exports: [RevenuePostingService, RevenueQueryService],
})
export class RevenueModule {}
