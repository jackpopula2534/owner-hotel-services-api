import { PartialType } from '@nestjs/swagger';
import { CreateAddonDto } from './create-addon.dto';

/**
 * Update DTO ใช้ทุก field ของ Create เป็น optional
 */
export class UpdateAddonDto extends PartialType(CreateAddonDto) {}
