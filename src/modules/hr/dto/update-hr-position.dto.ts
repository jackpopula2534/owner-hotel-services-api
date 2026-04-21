import { PartialType } from '@nestjs/swagger';
import { CreateHrPositionDto } from './create-hr-position.dto';

export class UpdateHrPositionDto extends PartialType(CreateHrPositionDto) {}
