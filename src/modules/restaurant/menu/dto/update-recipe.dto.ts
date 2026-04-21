import { PartialType } from '@nestjs/swagger';
import { CreateRecipeDto } from './create-recipe.dto';

/**
 * UpdateRecipeDto — all fields optional (same shape as CreateRecipeDto).
 * The upsert endpoint accepts both create and update payloads.
 */
export class UpdateRecipeDto extends PartialType(CreateRecipeDto) {}
