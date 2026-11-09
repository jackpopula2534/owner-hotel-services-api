/**
 * One-off backfill script — normalize legacy bookings so the availability
 * engine works correctly.
 *
 * Why this exists:
 *   The original seeder stored bookings with raw `checkIn` / `checkOut`
 *   Date objects that included the WALL-CLOCK TIME at which the seed
 *   script ran. If the seeder ran at, say, Bangkok 14:30 PM, every
 *   booking's stored `checkOut` was effectively "14:30 PM on day X",
 *   which then bled into the availability fallback query and made rooms
 *   look occupied for hours longer than they should be.
 *
 *   On top of that, those legacy bookings had NULL
 *   `scheduledCheckIn` / `scheduledCheckOut`, so the new time-aware
 *   overlap check fell through to the old fields.
 *
 * What this script does:
 *   For every booking in the database that is missing either scheduled
 *   field, fill them in using:
 *     - scheduledCheckIn  = checkIn date  at 14:00 Bangkok
 *     - scheduledCheckOut = checkOut date at 12:00 Bangkok
 *   It also rewrites the legacy `checkIn` / `checkOut` fields to be
 *   midnight UTC of the same calendar day so they stop polluting fallback
 *   queries.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/seeder/backfill-scheduled-times.ts
 *
 * Idempotent — safe to run multiple times.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildBangkokDateTime,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
} from '../common/availability/availability.util';
import { toBangkokDateString } from '../common/availability/bangkok-date.util';

const logger = new Logger('BackfillScheduledTimes');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  try {
    // Find all bookings that need backfill
    const bookingsToFix = await prisma.booking.findMany({
      where: {
        OR: [{ scheduledCheckIn: null }, { scheduledCheckOut: null }],
      },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        scheduledCheckIn: true,
        scheduledCheckOut: true,
      },
    });

    logger.log(`Found ${bookingsToFix.length} bookings needing scheduled-time backfill`);

    let fixed = 0;
    let skipped = 0;

    for (const booking of bookingsToFix) {
      if (!booking.checkIn || !booking.checkOut) {
        logger.warn(`Skipping booking ${booking.id} — missing checkIn/checkOut`);
        skipped += 1;
        continue;
      }

      const checkInDateStr = toBangkokDateString(booking.checkIn);
      const checkOutDateStr = toBangkokDateString(booking.checkOut);

      const scheduledCheckIn = buildBangkokDateTime(checkInDateStr, DEFAULT_CHECK_IN_TIME);
      const scheduledCheckOut = buildBangkokDateTime(checkOutDateStr, DEFAULT_CHECK_OUT_TIME);

      // Also re-normalize the legacy checkIn/checkOut to midnight UTC of the
      // SAME Bangkok calendar day, so any leftover fallback query is sane.
      const checkInMidnightUtc = new Date(`${checkInDateStr}T00:00:00.000Z`);
      const checkOutMidnightUtc = new Date(`${checkOutDateStr}T00:00:00.000Z`);

      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          scheduledCheckIn,
          scheduledCheckOut,
          checkIn: checkInMidnightUtc,
          checkOut: checkOutMidnightUtc,
        },
      });

      fixed += 1;
    }

    logger.log(`Backfill complete — fixed ${fixed}, skipped ${skipped}`);
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed: ' + ((error as Error).message || String(error)));
    process.exit(1);
  }
}

bootstrap();
