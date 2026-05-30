import { IsOptional, IsString } from 'class-validator';

export class ApprovePaymentDto {
  // Optional — when omitted, the controller falls back to the authenticated
  // admin's id from the JWT (req.user.id). Kept for backward compatibility
  // with callers that pass it explicitly.
  @IsOptional()
  @IsString()
  adminId?: string;

  // Reject flow reuses this DTO; reason is optional.
  @IsOptional()
  @IsString()
  reason?: string;
}
