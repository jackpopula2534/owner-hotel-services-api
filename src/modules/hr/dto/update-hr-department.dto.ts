import { PartialType } from '@nestjs/swagger';
import { CreateHrDepartmentDto } from './create-hr-department.dto';

export class UpdateHrDepartmentDto extends PartialType(CreateHrDepartmentDto) {}
