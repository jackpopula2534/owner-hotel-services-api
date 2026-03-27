import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SwitchTenantDto {
  @ApiProperty({
    description: 'The ID of the tenant to switch to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  tenantId: string;
}
