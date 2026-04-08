import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { UpsertEmployeeCodeConfigDto, PreviewEmployeeCodeDto } from './dto/employee-code-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / employee-code-config')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/employee-code-config', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class EmployeeCodeConfigController {
  constructor(private readonly configService: EmployeeCodeConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Get employee code configuration for current tenant' })
  @ApiResponse({ status: 200, description: 'Employee code config (or default if not configured)' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getConfig(@CurrentUser() user: { tenantId?: string }) {
    return this.configService.getConfig(user?.tenantId);
  }

  @Put()
  @ApiOperation({ summary: 'Create or update employee code configuration' })
  @ApiResponse({ status: 200, description: 'Config saved successfully' })
  @Roles('platform_admin', 'tenant_admin', 'admin')
  async upsertConfig(
    @Body() dto: UpsertEmployeeCodeConfigDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.configService.upsertConfig(user?.tenantId, dto);
  }

  @Get('preview')
  @ApiOperation({ summary: 'Preview the next employee code without incrementing the counter' })
  @ApiResponse({ status: 200, description: 'Preview employee code string' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async previewCode(
    @Query() query: PreviewEmployeeCodeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    const code = await this.configService.previewNextCode(
      user?.tenantId,
      query.departmentCode,
      query.propertyId,
    );
    return { code };
  }

  @Post('reset-counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset the running number counter to 1' })
  @ApiResponse({ status: 200, description: 'Counter reset successfully' })
  @Roles('platform_admin', 'tenant_admin', 'admin')
  async resetCounter(@CurrentUser() user: { tenantId?: string }) {
    return this.configService.resetCounter(user?.tenantId);
  }
}
