import { Controller, Get, Put, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApprovalFlowService } from './approval-flow.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class FlowStepDto {
  @ApiProperty({ enum: ['dept_head', 'hr', 'owner'] })
  @IsIn(['dept_head', 'hr', 'owner'])
  role: 'dept_head' | 'hr' | 'owner';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  label?: string;
}

class UpdateApprovalFlowDto {
  @ApiProperty({ type: [FlowStepDto], description: 'Ordered approval steps' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlowStepDto)
  steps: FlowStepDto[];
}

class UpdateEquipmentCategoriesDto {
  @ApiProperty({
    type: [String],
    description: 'Inventory ItemCategory ids that feed the equipment-requisition modal (empty = all)',
  })
  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];
}

type AuthUser = { tenantId?: string };

@ApiTags('hr / recruitment — approval flow setup')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/recruitment/approval-flows', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class ApprovalFlowController {
  constructor(private readonly service: ApprovalFlowService) {}

  @Get()
  @ApiOperation({ summary: 'List approval flows (manpower / budget / equipment) for the tenant' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@CurrentUser() user: AuthUser) {
    return this.service.getAll(user.tenantId!);
  }

  @Get('equipment-categories')
  @ApiOperation({ summary: 'Get inventory category ids configured for the equipment-requisition modal' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getEquipmentCategories(@CurrentUser() user: AuthUser) {
    const categoryIds = await this.service.getEquipmentCategories(user.tenantId!);
    return { categoryIds };
  }

  @Put('equipment-categories')
  @ApiOperation({ summary: 'Configure which inventory categories feed the equipment-requisition modal' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updateEquipmentCategories(
    @Body() dto: UpdateEquipmentCategoriesDto,
    @CurrentUser() user: AuthUser,
  ) {
    const categoryIds = await this.service.setEquipmentCategories(user.tenantId!, dto.categoryIds);
    return { categoryIds };
  }

  @Put(':flowType')
  @ApiOperation({ summary: 'Update an approval flow (ordered role steps)' })
  @ApiParam({ name: 'flowType', enum: ['manpower', 'budget', 'equipment'] })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('flowType') flowType: string,
    @Body() dto: UpdateApprovalFlowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(user.tenantId!, flowType, dto.steps);
  }
}
