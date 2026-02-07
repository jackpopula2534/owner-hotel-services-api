import { IsString, IsEmail } from 'class-validator';

export class InviteReferralDto {
  @IsEmail()
  email: string;
}
