import { PartialType } from '@nestjs/swagger';
import { CreateCostTypeDto } from './create-cost-type.dto';

export class UpdateCostTypeDto extends PartialType(CreateCostTypeDto) {}
