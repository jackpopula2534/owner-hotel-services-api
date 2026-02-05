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
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('restaurant')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'restaurant', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) {}

  @Get()
  @ApiOperation({ summary: 'Get all restaurants' })
  @ApiResponse({ status: 200, description: 'List of restaurants' })
  @Roles('admin', 'manager')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.restaurantService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get restaurant by ID' })
  @ApiResponse({ status: 200, description: 'Restaurant details' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  @Roles('admin', 'manager')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.restaurantService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new restaurant' })
  @ApiResponse({ status: 201, description: 'Restaurant created successfully' })
  @Roles('admin')
  async create(
    @Body() createRestaurantDto: CreateRestaurantDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.restaurantService.create(createRestaurantDto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update restaurant' })
  @ApiResponse({ status: 200, description: 'Restaurant updated successfully' })
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() updateRestaurantDto: UpdateRestaurantDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.restaurantService.update(id, updateRestaurantDto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete restaurant' })
  @ApiResponse({ status: 200, description: 'Restaurant deleted successfully' })
  @Roles('admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.restaurantService.remove(id, user?.tenantId);
  }
}

