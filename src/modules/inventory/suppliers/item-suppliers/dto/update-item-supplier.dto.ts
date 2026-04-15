import { PartialType } from '@nestjs/swagger';
import { CreateItemSupplierDto } from './create-item-supplier.dto';

export class UpdateItemSupplierDto extends PartialType(CreateItemSupplierDto) {}
