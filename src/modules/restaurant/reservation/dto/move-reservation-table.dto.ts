import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Move a booking (and its open bills) to another table. A reason is required. */
export class MoveReservationTableDto {
  @ApiProperty({ example: 'uuid-table-id', description: 'The table the party moves to' })
  @IsString()
  @IsNotEmpty()
  tableId: string;

  @ApiProperty({ example: 'ลูกค้าขอย้าย', description: 'Why the party is moved — kept on the booking timeline' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}
