/**
 * The POS "Add Table" form must survive the global ValidationPipe.
 *
 * `main.ts` runs `whitelist: true` + `forbidNonWhitelisted: true`, so any field
 * the DTO does not declare rejects the WHOLE request. The form has always had an
 * "Initial Status" dropdown and always sent `status`, while `CreateTableDto` had
 * no such field — so every create and every edit from the POS died with
 * "property status should not exist" before it ever reached the service.
 *
 * These tests run the real pipe with the real bootstrap options, so they fail
 * again if a field the form submits is dropped from the DTO.
 */

import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { CreateTableDto } from '../dto/create-table.dto';
import { UpdateTableDto } from '../dto/update-table.dto';
import { TableStatusEnum } from '../dto/update-table-status.dto';

/** Same options as `src/main.ts` — testing anything looser proves nothing. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const asCreate: ArgumentMetadata = { type: 'body', metatype: CreateTableDto };
const asUpdate: ArgumentMetadata = { type: 'body', metatype: UpdateTableDto };

/** Exactly what `TableModal` in `components/pos/TableView.tsx` submits. */
const FORM_PAYLOAD = {
  tableNumber: 'A1',
  capacity: 6,
  shape: 'RECTANGLE',
  status: 'AVAILABLE',
};

/** Every option in the form's Initial Status dropdown. */
const STATUS_OPTIONS = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE'];

describe('CreateTableDto — POS Add Table form', () => {
  it('accepts the payload the form actually sends', async () => {
    const result = await pipe.transform({ ...FORM_PAYLOAD }, asCreate);

    expect(result).toMatchObject({
      tableNumber: 'A1',
      capacity: 6,
      shape: 'RECTANGLE',
      status: TableStatusEnum.AVAILABLE,
    });
  });

  it.each(STATUS_OPTIONS)('accepts Initial Status = %s', async (status) => {
    await expect(pipe.transform({ ...FORM_PAYLOAD, status }, asCreate)).resolves.toMatchObject({
      status,
    });
  });

  it('still defaults the status server-side when the caller omits it', async () => {
    // The floor-plan editor creates tables without a status; Prisma's
    // `@default(AVAILABLE)` has to stay in charge there.
    const result = (await pipe.transform(
      { tableNumber: 'A2', capacity: 4, shape: 'SQUARE' },
      asCreate,
    )) as CreateTableDto;

    expect(result.status).toBeUndefined();
  });

  it('rejects a status that is not a real table status', async () => {
    await expect(
      pipe.transform({ ...FORM_PAYLOAD, status: 'PARTY_TIME' }, asCreate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still refuses fields nobody declared — the whitelist stays on', async () => {
    const rejection = await pipe
      .transform({ ...FORM_PAYLOAD, madeUpField: 'x' }, asCreate)
      .then(() => null)
      .catch((err: BadRequestException) => err);

    expect(rejection).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(rejection!.getResponse())).toContain('madeUpField');
  });

  it('requires a table number and a sane capacity', async () => {
    await expect(pipe.transform({ capacity: 4 }, asCreate)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      pipe.transform({ tableNumber: 'A1', capacity: 0 }, asCreate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateTableDto — POS Edit Table form', () => {
  it('accepts the same payload, since the edit form submits the whole table', async () => {
    await expect(
      pipe.transform({ ...FORM_PAYLOAD, status: 'CLEANING' }, asUpdate),
    ).resolves.toMatchObject({ tableNumber: 'A1', status: 'CLEANING' });
  });

  it('accepts a partial edit', async () => {
    await expect(pipe.transform({ capacity: 8 }, asUpdate)).resolves.toMatchObject({
      capacity: 8,
    });
  });
});

describe('CreateTableDto — furnitureType (รูปแบบโต๊ะ)', () => {
  it('accepts a table type the floor plan can draw', async () => {
    await expect(
      pipe.transform({ ...FORM_PAYLOAD, furnitureType: 'rect-table-6' }, asCreate),
    ).resolves.toMatchObject({ furnitureType: 'rect-table-6' });
  });

  it('stays optional — โต๊ะเก่าที่ไม่มี field นี้ยังสร้าง/แก้ไขได้', async () => {
    await expect(pipe.transform(FORM_PAYLOAD, asCreate)).resolves.not.toHaveProperty(
      'furnitureType',
    );
  });

  it('refuses a type the plan has no artwork for', async () => {
    // A value that reaches the DB but cannot be drawn leaves the table
    // invisible on the plan — reject it at the edge instead.
    await expect(
      pipe.transform({ ...FORM_PAYLOAD, furnitureType: 'hover-table' }, asCreate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets the edit form change only the type', async () => {
    await expect(
      pipe.transform({ furnitureType: 'booth-seat' }, asUpdate),
    ).resolves.toMatchObject({ furnitureType: 'booth-seat' });
  });
});
