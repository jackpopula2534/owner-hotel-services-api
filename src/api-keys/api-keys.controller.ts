import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiKeyScope, ApiKeysService } from './api-keys.service';

@ApiTags('API Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List API keys for the current tenant' })
  async list(@CurrentUser() user: any) {
    return this.service.list(user.tenant_id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new API key (plaintext shown once)' })
  async create(
    @CurrentUser() user: any,
    @Body() body: { name: string; scopes: ApiKeyScope[]; expiresAt?: string },
  ) {
    return this.service.create({
      tenantId: user.tenant_id,
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt,
      createdBy: user.id || user.user_id,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@CurrentUser() user: any, @Param('id') id: string) {
    await this.service.revoke(id, user.tenant_id);
    return { success: true };
  }
}
