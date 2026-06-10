import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { HrTrainingService } from './hr-training.service';
import { CreateHrTrainingRecordDto, UpdateHrTrainingRecordDto } from './dto/hr-training.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / training')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/training-records', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrTrainingController {
  constructor(private readonly service: HrTrainingService) {}

  @Get()
  @ApiOperation({ summary: 'List training / certification records' })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: ['training', 'certification'] })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'expiringInDays', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(@Query() query: Record<string, string>, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a training record by ID' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Create a training record' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(@Body() dto: CreateHrTrainingRecordDto, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.create(dto, user.tenantId!, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a training record' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHrTrainingRecordDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a training record' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user.tenantId!);
  }
}
