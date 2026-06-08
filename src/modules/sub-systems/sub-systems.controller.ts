import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubSystemsService } from './sub-systems.service';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

@ApiTags('Sub Systems')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'sub-systems', version: '1' })
export class SubSystemsController {
  constructor(private readonly service: SubSystemsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({
    summary: 'List sub-system terminals available to the current tenant',
    description:
      'Returns the terminal cards for the "ระบบย่อย / Sub Systems" page. ' +
      'Each card is unlocked by a core entitlement or an active add-on. ' +
      'Frontend should fetch this instead of hard-coding the card list.',
  })
  @ApiResponse({ status: 200, description: 'Sub-system cards (available + locked)' })
  async list(@CurrentUser() caller: AuthenticatedCaller) {
    return this.service.getForTenant(caller?.tenantId ?? '');
  }
}
