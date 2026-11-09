import { PartialType } from '@nestjs/swagger';
import { CreateGuestDto } from './create-guest.dto';

/**
 * UpdateGuestDto — payload for PUT/PATCH /api/v1/guests/:id.
 *
 * All CreateGuestDto fields become optional. Validation rules (type, length,
 * email format, etc.) still apply when a field is present.
 */
export class UpdateGuestDto extends PartialType(CreateGuestDto) {}
