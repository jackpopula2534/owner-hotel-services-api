import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApprovalFlowsService } from './approval-flows.service';
import {
  ApprovalDocumentTypeDto,
  CreateApprovalFlowDto,
  UpdateApprovalFlowDto,
} from './dto/approval-flow.dto';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

const ADMIN_ROLES = new Set([
  'tenant_admin',
  'manager',
  'platform_admin',
  'admin',
  'procurement_manager',
]);

@ApiTags('Procurement - Approval Flows')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'procurement/approval-flows', version: '1' })
export class ApprovalFlowsController {
  constructor(private readonly service: ApprovalFlowsService) {}

  private assertAdmin(caller: AuthenticatedCaller): void {
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException('Only tenant admins and procurement managers can manage approval flows');
    }
  }

  private assertTenant(caller: AuthenticatedCaller): string {
    if (!caller.tenantId) {
      throw new ForbiddenException('No active tenant');
    }
    return caller.tenantId;
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Create an approval flow template' })
  @ApiResponse({ status: 201, description: 'Flow created' })
  async create(
    @Body() dto: CreateApprovalFlowDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertAdmin(caller);
    return this.service.create(dto, this.assertTenant(caller), caller.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List approval flows for the current tenant' })
  @ApiQuery({
    name: 'documentType',
    enum: ApprovalDocumentTypeDto,
    required: false,
  })
  async list(
    @CurrentUser() caller: AuthenticatedCaller,
    @Query('documentType') documentType?: ApprovalDocumentTypeDto,
  ) {
    this.assertAdmin(caller);
    return this.service.findAll(this.assertTenant(caller), documentType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get approval flow detail' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertAdmin(caller);
    return this.service.findOne(id, this.assertTenant(caller));
  }

  @Patch(':id')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({
    summary: 'Update an approval flow (steps are replaced wholesale if supplied)',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalFlowDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertAdmin(caller);
    return this.service.update(id, this.assertTenant(caller), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an approval flow' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertAdmin(caller);
    return this.service.remove(id, this.assertTenant(caller));
  }
}
