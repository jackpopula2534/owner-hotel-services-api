import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum TableStatusEnum {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  OCCUPIED = 'OCCUPIED',
  CLEANING = 'CLEANING',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

export class UpdateTableStatusDto {
  @ApiProperty({ enum: TableStatusEnum, example: TableStatusEnum.AVAILABLE })
  @IsEnum(TableStatusEnum)
  @IsNotEmpty()
  status: TableStatusEnum;
}
