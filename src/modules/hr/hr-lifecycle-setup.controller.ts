import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HrLifecycleSetupService } from './hr-lifecycle-setup.service';
import { HrLifecycleAssignmentService } from './hr-lifecycle-assignment.service';
import {
  BulkAssignPackageDto,
  BulkVerifyRequirementsDto,
  CreateHrDocumentTypeDto,
  CreateHrLifecycleAssignmentRuleDto,
  CreateHrLifecyclePackageDto,
  UpdateHrDocumentTypeDto,
  UpdateHrLifecycleAssignmentRuleDto,
  UpdateHrLifecyclePackageDto,
  WaiveRequirementDto,
} from './dto/hr-lifecycle-setup.dto';

@ApiTags('hr / lifecycle setup')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/lifecycle', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrLifecycleSetupController {
  constructor(
    private readonly setupService: HrLifecycleSetupService,
    private readonly assignmentService: HrLifecycleAssignmentService,
  ) {}

  @Get('document-types')
  @ApiOperation({ summary: 'List lifecycle document types' })
  @ApiQuery({ name: 'activeOnly', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async listDocumentTypes(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.listDocumentTypes(user.tenantId!, query);
  }

  @Get('document-types/:id')
  @ApiOperation({ summary: 'Get one lifecycle document type' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async getDocumentType(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.getDocumentType(id, user.tenantId!);
  }

  @Post('document-types')
  @ApiOperation({ summary: 'Create lifecycle document type' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async createDocumentType(
    @Body() dto: CreateHrDocumentTypeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.createDocumentType(dto, user.tenantId!);
  }

  @Patch('document-types/:id')
  @ApiOperation({ summary: 'Update lifecycle document type' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updateDocumentType(
    @Param('id') id: string,
    @Body() dto: UpdateHrDocumentTypeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.updateDocumentType(id, dto, user.tenantId!);
  }

  @Delete('document-types/:id')
  @ApiOperation({ summary: 'Delete lifecycle document type' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async deleteDocumentType(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.deleteDocumentType(id, user.tenantId!);
  }

  @Get('packages')
  @ApiOperation({ summary: 'List lifecycle packages' })
  @ApiQuery({ name: 'lifecycleType', required: false, type: String })
  @ApiQuery({ name: 'activeOnly', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async listPackages(@Query() query: Record<string, string>, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.listPackages(user.tenantId!, query);
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'Get one lifecycle package' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async getPackage(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.getPackage(id, user.tenantId!);
  }

  @Post('packages')
  @ApiOperation({ summary: 'Create lifecycle package' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async createPackage(
    @Body() dto: CreateHrLifecyclePackageDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.createPackage(dto, user.tenantId!);
  }

  @Patch('packages/:id')
  @ApiOperation({ summary: 'Update lifecycle package' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdateHrLifecyclePackageDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.updatePackage(id, dto, user.tenantId!);
  }

  @Delete('packages/:id')
  @ApiOperation({ summary: 'Delete lifecycle package' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async deletePackage(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.deletePackage(id, user.tenantId!);
  }

  @Get('rules')
  @ApiOperation({ summary: 'List lifecycle assignment rules' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async listRules(@CurrentUser() user: { tenantId?: string }) {
    return this.setupService.listRules(user.tenantId!);
  }

  @Get('rules/:id')
  @ApiOperation({ summary: 'Get one lifecycle assignment rule' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async getRule(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.getRule(id, user.tenantId!);
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create lifecycle assignment rule' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async createRule(
    @Body() dto: CreateHrLifecycleAssignmentRuleDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.createRule(dto, user.tenantId!);
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: 'Update lifecycle assignment rule' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateHrLifecycleAssignmentRuleDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.setupService.updateRule(id, dto, user.tenantId!);
  }

  @Delete('rules/:id')
  @ApiOperation({ summary: 'Delete lifecycle assignment rule' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async deleteRule(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.setupService.deleteRule(id, user.tenantId!);
  }

  @Post('assignments/recompute/:employeeId')
  @ApiOperation({ summary: 'Recompute lifecycle package assignments and requirements for an employee' })
  @ApiParam({ name: 'employeeId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async recomputeAssignments(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.assignmentService.recomputeForEmployee(employeeId, user.tenantId!, user.id);
  }

  @Get('requirements')
  @ApiOperation({ summary: 'Get lifecycle document requirements for an employee' })
  @ApiQuery({ name: 'employeeId', required: true, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getRequirements(
    @Query('employeeId') employeeId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.assignmentService.getRequirements(employeeId, user.tenantId!);
  }

  @Patch('requirements/:id/verify')
  @ApiOperation({ summary: 'Mark a document requirement as verified' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async verifyRequirement(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.assignmentService.verifyRequirement(id, user.tenantId!, user.id);
  }

  @Patch('requirements/:id/waive')
  @ApiOperation({ summary: 'Waive a document requirement' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async waiveRequirement(
    @Param('id') id: string,
    @Body() dto: WaiveRequirementDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.assignmentService.waiveRequirement(id, user.tenantId!, dto.reason);
  }

  @Post('assignments/bulk')
  @ApiOperation({ summary: 'Assign a lifecycle package to many employees at once' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async bulkAssign(
    @Body() dto: BulkAssignPackageDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.assignmentService.bulkAssignPackage(
      { employeeIds: dto.employeeIds, packageId: dto.packageId },
      user.tenantId!,
      user.id,
    );
  }

  @Patch('requirements/bulk-verify')
  @ApiOperation({ summary: 'Verify multiple uploaded document requirements at once' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async bulkVerify(
    @Body() dto: BulkVerifyRequirementsDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.assignmentService.bulkVerifyRequirements(dto.ids, user.tenantId!, user.id);
  }

  @Post('seed-starter')
  @ApiOperation({ summary: 'Seed recommended hotel document types and lifecycle packages' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async seedStarter(@CurrentUser() user: { tenantId?: string }) {
    return this.setupService.seedStarterData(user.tenantId!);
  }

  @Get('report')
  @ApiOperation({ summary: 'Tenant-wide requirements report (missing / expiring)' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'expiringInDays', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getReport(
    @Query() query: { status?: string; expiringInDays?: string },
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.assignmentService.getRequirementsReport(user.tenantId!, query);
  }
}
