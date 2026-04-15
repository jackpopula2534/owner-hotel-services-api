import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompareSnapshotsDto {
  @ApiProperty({
    description: 'First snapshot ID for comparison',
    example: 'uuid-of-snapshot',
  })
  @IsString()
  @IsUUID()
  snapshot1Id: string;

  @ApiProperty({
    description: 'Second snapshot ID for comparison',
    example: 'uuid-of-snapshot',
  })
  @IsString()
  @IsUUID()
  snapshot2Id: string;
}
