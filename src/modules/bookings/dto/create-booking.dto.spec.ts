import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';

describe('CreateBookingDto', () => {
  it('accepts frontend booking metadata fields without whitelist errors', () => {
    const dto = plainToInstance(CreateBookingDto, {
      propertyId: '550e8400-e29b-41d4-a716-446655440000',
      roomId: '550e8400-e29b-41d4-a716-446655440001',
      property: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      roomTypeIds: ['deluxe'],
      guestName: 'John Doe',
      checkInDate: '2026-04-10',
      checkOutDate: '2026-04-12',
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.not.arrayContaining(['property', 'roomTypeIds', 'guestName', 'checkInDate', 'checkOutDate']),
    );
  });
});
