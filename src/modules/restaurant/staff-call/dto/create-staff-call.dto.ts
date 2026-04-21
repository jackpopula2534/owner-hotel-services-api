import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CallTypeDto {
  SERVICE = 'SERVICE',
  PAYMENT = 'PAYMENT',
  WATER = 'WATER',
  ASSISTANCE = 'ASSISTANCE',
  CLEANUP = 'CLEANUP',
  CUSTOM = 'CUSTOM',
}

export enum CallSourceDto {
  CUSTOMER = 'CUSTOMER',
  POS = 'POS',
}

export class CreateStaffCallDto {
  @ApiProperty({ description: 'Table ID', example: 'uuid-of-table' })
  @IsString()
  @IsNotEmpty()
  tableId: string;

  @ApiProperty({ enum: CallTypeDto, default: CallTypeDto.SERVICE })
  @IsEnum(CallTypeDto)
  @IsOptional()
  callType?: CallTypeDto;

  @ApiPropertyOptional({ description: 'Custom message from customer' })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({ description: 'Customer name (from QR scan)' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiProperty({ enum: CallSourceDto, default: CallSourceDto.CUSTOMER })
  @IsEnum(CallSourceDto)
  @IsOptional()
  source?: CallSourceDto;
}
