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
import { HrService } from './hr.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('hr')
@ApiBearerAuth('JWT-auth')
@Controller('hr')
@UseGuards(JwtAuthGuard)
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get()
  @ApiOperation({ summary: 'Get all employees' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  async findAll(@Query() query: any) {
    return this.hrService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  @ApiResponse({ status: 200, description: 'Employee details' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async findOne(@Param('id') id: string) {
    return this.hrService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new employee' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  async create(@Body() createEmployeeDto: CreateEmployeeDto) {
    return this.hrService.create(createEmployeeDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  async update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return this.hrService.update(id, updateEmployeeDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete employee' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  async remove(@Param('id') id: string) {
    return this.hrService.remove(id);
  }
}

