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
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('rooms')
@ApiBearerAuth('JWT-auth')
@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all rooms' })
  @ApiResponse({ status: 200, description: 'List of rooms' })
  async findAll(@Query() query: any) {
    return this.roomsService.findAll(query);
  }

  @Get('available')
  @ApiOperation({ summary: 'Get available rooms for date range' })
  @ApiResponse({ status: 200, description: 'List of available rooms' })
  async getAvailableRooms(
    @Query('checkIn') checkIn: string,
    @Query('checkOut') checkOut: string,
  ) {
    return this.roomsService.getAvailableRooms(checkIn, checkOut);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get room by ID' })
  @ApiResponse({ status: 200, description: 'Room details' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  async findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new room' })
  @ApiResponse({ status: 201, description: 'Room created successfully' })
  async create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update room' })
  @ApiResponse({ status: 200, description: 'Room updated successfully' })
  async update(@Param('id') id: string, @Body() updateRoomDto: UpdateRoomDto) {
    return this.roomsService.update(id, updateRoomDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update room status' })
  @ApiResponse({ status: 200, description: 'Room status updated' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.roomsService.updateStatus(id, status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete room' })
  @ApiResponse({ status: 200, description: 'Room deleted successfully' })
  async remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}

