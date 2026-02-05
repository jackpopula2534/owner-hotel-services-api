import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('channels')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'channels', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all channels' })
  @ApiResponse({ status: 200, description: 'List of channels' })
  @Roles('admin', 'manager')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.channelsService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  @ApiResponse({ status: 200, description: 'Channel details' })
  @ApiResponse({ status: 404, description: 'Channel not found' })
  @Roles('admin', 'manager')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.channelsService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new channel' })
  @ApiResponse({ status: 201, description: 'Channel created successfully' })
  @Roles('admin')
  async create(
    @Body() createChannelDto: CreateChannelDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.channelsService.create(createChannelDto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update channel' })
  @ApiResponse({ status: 200, description: 'Channel updated successfully' })
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() updateChannelDto: UpdateChannelDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.channelsService.update(id, updateChannelDto, user?.tenantId);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Sync channel data' })
  @ApiResponse({ status: 200, description: 'Channel sync initiated' })
  @Roles('admin', 'manager')
  async sync(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.channelsService.sync(id, user?.tenantId);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: 'Toggle channel active status' })
  @ApiResponse({ status: 200, description: 'Channel status updated' })
  @Roles('admin')
  async toggleActive(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.channelsService.toggleActive(id, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete channel' })
  @ApiResponse({ status: 200, description: 'Channel deleted successfully' })
  @Roles('admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.channelsService.remove(id, user?.tenantId);
  }
}

