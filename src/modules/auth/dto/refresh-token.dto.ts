import { IsIn, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SESSION_CONTEXTS, type SessionContext } from '../terminal-refresh-cookie';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    example: 'your-refresh-token-here',
    description: 'Optional — browsers send the refresh token as the httpOnly cookie ss_rt_<context> instead.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;

  @ApiPropertyOptional({
    enum: SESSION_CONTEXTS,
    description: 'Session (main or a staff terminal) whose httpOnly refresh cookie (ss_rt_<context>) is used when refreshToken is omitted or no longer valid (another tab already rotated it).',
  })
  @IsOptional()
  @IsIn(SESSION_CONTEXTS as unknown as string[])
  context?: SessionContext;
}
