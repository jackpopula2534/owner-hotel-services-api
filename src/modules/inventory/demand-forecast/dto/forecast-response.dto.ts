import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DemandForecastItemDto {
  @ApiProperty({
    description: 'Inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  itemId: string;

  @ApiProperty({
    description: 'Item name',
    example: 'Pillow (Standard)',
  })
  itemName: string;

  @ApiProperty({
    description: 'Item SKU',
    example: 'SKU-PILLOW-001',
  })
  sku: string;

  @ApiProperty({
    description: 'Total quantity required based on bookings',
    example: 120,
  })
  totalRequired: number;

  @ApiProperty({
    description: 'Current available stock',
    example: 100,
  })
  currentStock: number;

  @ApiProperty({
    description: 'Inventory deficit (negative means surplus)',
    example: 20,
  })
  deficit: number;

  @ApiProperty({
    description: 'Unit of measurement',
    example: 'pieces',
  })
  unit: string;

  @ApiPropertyOptional({
    description: 'Related room type',
    example: 'Deluxe Room',
  })
  roomType?: string;

  @ApiPropertyOptional({
    description: 'Number of bookings requiring this item',
    example: 10,
  })
  bookingCount?: number;
}

export class DemandForecastResponseDto {
  @ApiProperty({
    description: 'Property ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  propertyId: string;

  @ApiProperty({
    description: 'Start date of forecast period',
    example: '2026-04-15',
  })
  startDate: string;

  @ApiProperty({
    description: 'End date of forecast period',
    example: '2026-04-22',
  })
  endDate: string;

  @ApiProperty({
    description: 'Total number of bookings in the period',
    example: 15,
  })
  totalBookings: number;

  @ApiProperty({
    description: 'Array of demand forecast items',
    type: [DemandForecastItemDto],
  })
  items: DemandForecastItemDto[];

  @ApiPropertyOptional({
    description: 'Number of items with deficit',
    example: 5,
  })
  itemsWithDeficit?: number;

  @ApiPropertyOptional({
    description: 'Timestamp of forecast generation',
    example: '2026-04-15T10:30:00Z',
  })
  generatedAt?: string;
}

export class RoomTypeOccupancyDto {
  @ApiProperty({
    description: 'Room type name',
    example: 'Deluxe Room',
  })
  roomType: string;

  @ApiProperty({
    description: 'Total rooms of this type',
    example: 20,
  })
  totalRooms: number;

  @ApiProperty({
    description: 'Number of booked rooms',
    example: 18,
  })
  bookedRooms: number;

  @ApiProperty({
    description: 'Occupancy percentage (0-100)',
    example: 90,
  })
  occupancyPercentage: number;
}

export class OccupancyForecastResponseDto {
  @ApiProperty({
    description: 'Property ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  propertyId: string;

  @ApiProperty({
    description: 'Start date of forecast period',
    example: '2026-04-15',
  })
  startDate: string;

  @ApiProperty({
    description: 'End date of forecast period',
    example: '2026-04-22',
  })
  endDate: string;

  @ApiProperty({
    description: 'Total rooms in the property',
    example: 100,
  })
  totalRooms: number;

  @ApiProperty({
    description: 'Total booked rooms',
    example: 85,
  })
  bookedRooms: number;

  @ApiProperty({
    description: 'Overall occupancy percentage (0-100)',
    example: 85,
  })
  occupancyPercentage: number;

  @ApiProperty({
    description: 'Total number of bookings',
    example: 50,
  })
  totalBookings: number;

  @ApiProperty({
    description: 'Occupancy breakdown by room type',
    type: [RoomTypeOccupancyDto],
  })
  byRoomType: RoomTypeOccupancyDto[];

  @ApiPropertyOptional({
    description: 'Timestamp of forecast generation',
    example: '2026-04-15T10:30:00Z',
  })
  generatedAt?: string;
}
