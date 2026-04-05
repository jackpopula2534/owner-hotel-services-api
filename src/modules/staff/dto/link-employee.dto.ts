import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';

export class LinkEmployeeDto {
  @ApiProperty({
    description: 'Employee ID to link to this Staff record (requires HR_MODULE add-on)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsNotEmpty()
  @IsUUID()
  employeeId: string;
}
