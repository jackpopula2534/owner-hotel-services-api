import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ComponentStatus,
  IncidentSeverity,
  IncidentStatus,
  StatusPageService,
} from './status-page.service';

@ApiTags('Status Page')
@Controller({ path: 'status', version: '1' })
export class StatusPageController {
  constructor(private readonly service: StatusPageService) {}

  @Get('public')
  @ApiOperation({ summary: 'Public status page payload (no auth)' })
  async publicStatus() {
    return this.service.getPublicStatus();
  }

  @Post('admin/components')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '[Admin] Upsert a service component' })
  async upsertComponent(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      displayOrder?: number;
      status?: ComponentStatus;
    },
  ) {
    return this.service.upsertComponent(body);
  }

  @Patch('admin/components/:code/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '[Admin] Change component status' })
  async setComponentStatus(@Param('code') code: string, @Body('status') status: ComponentStatus) {
    await this.service.updateComponentStatus(code, status);
    return { success: true };
  }

  @Post('admin/incidents')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '[Admin] Create a new incident' })
  async createIncident(
    @CurrentUser() user: any,
    @Body()
    body: {
      title: string;
      severity?: IncidentSeverity;
      affectedComponents?: string[];
      initialUpdate: string;
    },
  ) {
    return this.service.createIncident({
      ...body,
      createdBy: user.id || user.user_id,
    });
  }

  @Post('admin/incidents/:id/updates')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '[Admin] Append an incident update' })
  async addUpdate(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { status: IncidentStatus; message: string },
  ) {
    await this.service.addIncidentUpdate({
      incidentId: id,
      status: body.status,
      message: body.message,
      createdBy: user.id || user.user_id,
    });
    return { success: true };
  }
}
