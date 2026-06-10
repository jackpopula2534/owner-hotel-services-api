import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { HrOvertimeService } from './hr-overtime.service';
import {
  CreateHrOvertimeRequestDto,
  ReviewHrOvertimeRequestDto,
} from './dto/create-hr-overtime-request.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / overtime')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/overtime-requests', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrOvertimeController {
  constructor(private readonly service: HrOvertimeService) {}

  @Get()
  @ApiOperation({ summary: 'List overtime requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get overtime request by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Submit an overtime request' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(
    @Body() dto: CreateHrOvertimeRequestDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.create(dto, user.tenantId!, user.id);
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Approve or reject an overtime request' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 400, description: 'Already reviewed' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewHrOvertimeRequestDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.review(id, dto, user.id ?? 'system', user.tenantId!);
  }
}
