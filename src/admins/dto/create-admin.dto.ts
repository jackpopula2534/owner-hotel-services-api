import { IsString, IsEnum, IsEmail } from 'class-validator';
import { AdminRole } from '../entities/admin.entity';

export class CreateAdminDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(AdminRole)
  role: AdminRole;
}


