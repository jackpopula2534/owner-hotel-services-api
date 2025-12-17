import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GuestsService } from './guests.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('guests')
@ApiBearerAuth('JWT-auth')
@Controller('guests')
@UseGuards(JwtAuthGuard)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all guests' })
  async findAll(@Query() query: any) {
    return this.guestsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get guest by ID' })
  async findOne(@Param('id') id: string) {
    return this.guestsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new guest' })
  async create(@Body() createGuestDto: any) {
    return this.guestsService.create(createGuestDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update guest' })
  async update(@Param('id') id: string, @Body() updateGuestDto: any) {
    return this.guestsService.update(id, updateGuestDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete guest' })
  async remove(@Param('id') id: string) {
    return this.guestsService.remove(id);
  }
}

