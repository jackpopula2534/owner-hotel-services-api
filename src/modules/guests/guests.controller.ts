import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GuestsService } from './guests.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('guests')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'guests', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all guests' })
  @Roles('admin', 'manager')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get guest by ID' })
  @Roles('admin', 'manager')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new guest' })
  @Roles('admin', 'manager')
  async create(@Body() createGuestDto: any, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.create(createGuestDto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update guest' })
  @Roles('admin', 'manager')
  async update(
    @Param('id') id: string,
    @Body() updateGuestDto: any,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.guestsService.update(id, updateGuestDto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete guest' })
  @Roles('admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.remove(id, user?.tenantId);
  }
}

