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
import { RestaurantService } from './restaurant.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('restaurant')
@ApiBearerAuth('JWT-auth')
@Controller('restaurant')
@UseGuards(JwtAuthGuard)
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) {}

  @Get()
  @ApiOperation({ summary: 'Get all restaurants' })
  @ApiResponse({ status: 200, description: 'List of restaurants' })
  async findAll(@Query() query: any) {
    return this.restaurantService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get restaurant by ID' })
  @ApiResponse({ status: 200, description: 'Restaurant details' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async findOne(@Param('id') id: string) {
    return this.restaurantService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new restaurant' })
  @ApiResponse({ status: 201, description: 'Restaurant created successfully' })
  async create(@Body() createRestaurantDto: CreateRestaurantDto) {
    return this.restaurantService.create(createRestaurantDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update restaurant' })
  @ApiResponse({ status: 200, description: 'Restaurant updated successfully' })
  async update(
    @Param('id') id: string,
    @Body() updateRestaurantDto: UpdateRestaurantDto,
  ) {
    return this.restaurantService.update(id, updateRestaurantDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete restaurant' })
  @ApiResponse({ status: 200, description: 'Restaurant deleted successfully' })
  async remove(@Param('id') id: string) {
    return this.restaurantService.remove(id);
  }
}

