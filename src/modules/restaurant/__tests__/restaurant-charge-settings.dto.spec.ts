/**
 * The charge switches decide what a guest is billed, so they get validated
 * harder than the rest of the outlet form.
 *
 * The global ValidationPipe runs with `enableImplicitConversion`, which turns
 * any non-empty string into `true` before `@IsBoolean()` ever sees it — so the
 * string `"false"` used to switch VAT *on*. These specs run the DTO through the
 * pipe's real options rather than calling the validator directly, because it is
 * that conversion step that carried the bug.
 */

import { ValidationPipe } from '@nestjs/common';
import { UpdateRestaurantDto } from '../dto/update-restaurant.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const metadata = {
  type: 'body' as const,
  metatype: UpdateRestaurantDto,
};

const run = (body: Record<string, unknown>) => pipe.transform(body, metadata);

describe('UpdateRestaurantDto — charge settings', () => {
  describe('boolean switches', () => {
    it('reads a real boolean straight through', async () => {
      await expect(run({ vatEnabled: false })).resolves.toMatchObject({ vatEnabled: false });
      await expect(run({ serviceChargeEnabled: false })).resolves.toMatchObject({
        serviceChargeEnabled: false,
      });
    });

    it('does not turn the string "false" into true', async () => {
      // The whole point: implicit conversion used to make this `true`.
      await expect(run({ vatEnabled: 'false' })).resolves.toMatchObject({ vatEnabled: false });
      await expect(run({ serviceChargeEnabled: 'false' })).resolves.toMatchObject({
        serviceChargeEnabled: false,
      });
    });

    it('accepts the string "true" as true', async () => {
      await expect(run({ vatEnabled: 'true' })).resolves.toMatchObject({ vatEnabled: true });
    });

    it('rejects anything that does not unambiguously spell a boolean', async () => {
      await expect(run({ vatEnabled: 'yes' })).rejects.toThrow();
      await expect(run({ vatEnabled: 1 })).rejects.toThrow();
      await expect(run({ serviceChargeEnabled: 'off' })).rejects.toThrow();
    });

    it('treats an explicit null as "leave it alone" rather than writing NULL', async () => {
      // The columns are NOT NULL — a null used to reach Prisma and come back as a
      // raw driver error.
      await expect(run({ vatEnabled: null })).resolves.not.toHaveProperty('vatEnabled', null);
    });
  });

  describe('rates', () => {
    it('accepts a percentage inside 0–100', async () => {
      await expect(run({ vatRate: 7, serviceRate: 10 })).resolves.toMatchObject({
        vatRate: 7,
        serviceRate: 10,
      });
      await expect(run({ serviceRate: 0 })).resolves.toMatchObject({ serviceRate: 0 });
    });

    it('rejects a rate outside 0–100', async () => {
      await expect(run({ vatRate: 150 })).rejects.toThrow();
      await expect(run({ serviceRate: -3 })).rejects.toThrow();
    });

    it('rejects more precision than the DECIMAL(5,2) column can hold', async () => {
      await expect(run({ vatRate: 7.005 })).rejects.toThrow();
    });

    it('rejects a rate that is not a number at all', async () => {
      await expect(run({ serviceRate: 'ten' })).rejects.toThrow();
    });
  });

  it('still refuses unknown fields', async () => {
    await expect(run({ serviceChargeRate: 10 })).rejects.toThrow();
  });
});
