import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/**
 * Body of every POST /auth/<system>-launch/exchange — trades the 5-minute
 * deep-link token for a real session (access + refresh) so the terminal can
 * stay open all shift instead of dying when the launch token expires.
 *
 * Which system the token opens is decided by the claim inside it, not by this
 * body, so one shape serves POS, Purchasing and the Hotel Terminal alike.
 */
export class LaunchExchangeDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'The launch token handed over in the /<system>?token=... deep link',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
