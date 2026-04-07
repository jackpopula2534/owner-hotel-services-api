import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HrMasterDataService } from './hr-master-data.service';
import { CreateHrDepartmentDto } from './dto/create-hr-department.dto';
import { UpdateHrDepartmentDto } from './dto/update-hr-department.dto';
import { CreateHrPositionDto } from './dto/create-hr-position.dto';
import { UpdateHrPositionDto } from './dto/update-hr-position.dto';
import { CreateHrLeaveTypeDto } from './dto/create-hr-leave-type.dto';
import { CreateHrShiftTypeDto } from './dto/create-hr-shift-type.dto';
import { CreateHrAllowanceTypeDto } from './dto/create-hr-allowance-type.dto';
import { CreateHrDeductionTypeDto } from './dto/create-hr-deduction-type.dto';

@ApiTags('HR Master Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
@Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
@Controller({ path: 'hr/master-data', version: '1' })
export class HrMasterDataController {
  constructor(private readonly hrMasterDataService: HrMasterDataService) {}

  // ─── SUMMARY ──────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'ดึง Master Data ทั้งหมดในครั้งเดียว' })
  @ApiResponse({ status: 200, description: 'Master data summary' })
  getSummary(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.getSummary(req.user.tenantId);
  }

  @Post('initialize-defaults')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ตั้งค่าข้อมูล HR เริ่มต้น สำหรับ Tenant ใหม่ (แผนก, ตำแหน่ง, ประเภทลา, กะ, เบี้ยเลี้ยง, การหัก)' })
  @ApiResponse({ status: 200, description: 'Defaults initialized successfully' })
  initializeDefaults(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.initializeDefaults(req.user.tenantId);
  }

  // ─── DEPARTMENTS ──────────────────────────────────────────────────────────

  @Get('departments')
  @ApiOperation({ summary: 'ดึงรายการแผนกทั้งหมด' })
  findAllDepartments(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.findAllDepartments(req.user.tenantId);
  }

  @Get('departments/:id')
  @ApiOperation({ summary: 'ดึงข้อมูลแผนกตาม ID' })
  findOneDepartment(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.findOneDepartment(req.user.tenantId, id);
  }

  @Post('departments')
  @ApiOperation({ summary: 'เพิ่มแผนกใหม่' })
  @ApiResponse({ status: 201, description: 'Department created' })
  createDepartment(
    @Body() dto: CreateHrDepartmentDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.createDepartment(req.user.tenantId, dto);
  }

  @Patch('departments/:id')
  @ApiOperation({ summary: 'แก้ไขข้อมูลแผนก' })
  updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateHrDepartmentDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.updateDepartment(req.user.tenantId, id, dto);
  }

  @Delete('departments/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ลบแผนก' })
  removeDepartment(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.removeDepartment(req.user.tenantId, id);
  }

  // ─── POSITIONS ────────────────────────────────────────────────────────────

  @Get('positions')
  @ApiOperation({ summary: 'ดึงรายการตำแหน่งทั้งหมด' })
  @ApiQuery({ name: 'departmentId', required: false })
  findAllPositions(
    @Query('departmentId') departmentId: string | undefined,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.findAllPositions(req.user.tenantId, departmentId);
  }

  @Get('positions/:id')
  @ApiOperation({ summary: 'ดึงข้อมูลตำแหน่งตาม ID' })
  findOnePosition(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.findOnePosition(req.user.tenantId, id);
  }

  @Post('positions')
  @ApiOperation({ summary: 'เพิ่มตำแหน่งใหม่' })
  createPosition(
    @Body() dto: CreateHrPositionDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.createPosition(req.user.tenantId, dto);
  }

  @Patch('positions/:id')
  @ApiOperation({ summary: 'แก้ไขข้อมูลตำแหน่ง' })
  updatePosition(
    @Param('id') id: string,
    @Body() dto: UpdateHrPositionDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.updatePosition(req.user.tenantId, id, dto);
  }

  @Delete('positions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ลบตำแหน่ง' })
  removePosition(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.removePosition(req.user.tenantId, id);
  }

  // ─── LEAVE TYPES ──────────────────────────────────────────────────────────

  @Get('leave-types')
  @ApiOperation({ summary: 'ดึงรายการประเภทการลาทั้งหมด' })
  findAllLeaveTypes(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.findAllLeaveTypes(req.user.tenantId);
  }

  @Post('leave-types')
  @ApiOperation({ summary: 'เพิ่มประเภทการลาใหม่' })
  createLeaveType(
    @Body() dto: CreateHrLeaveTypeDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.createLeaveType(req.user.tenantId, dto);
  }

  @Patch('leave-types/:id')
  @ApiOperation({ summary: 'แก้ไขประเภทการลา' })
  updateLeaveType(
    @Param('id') id: string,
    @Body() dto: Partial<CreateHrLeaveTypeDto>,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.updateLeaveType(req.user.tenantId, id, dto);
  }

  @Delete('leave-types/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ลบประเภทการลา' })
  removeLeaveType(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.removeLeaveType(req.user.tenantId, id);
  }

  // ─── SHIFT TYPES ──────────────────────────────────────────────────────────

  @Get('shift-types')
  @ApiOperation({ summary: 'ดึงรายการกะการทำงานทั้งหมด' })
  findAllShiftTypes(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.findAllShiftTypes(req.user.tenantId);
  }

  @Post('shift-types')
  @ApiOperation({ summary: 'เพิ่มกะการทำงานใหม่' })
  createShiftType(
    @Body() dto: CreateHrShiftTypeDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.createShiftType(req.user.tenantId, dto);
  }

  @Patch('shift-types/:id')
  @ApiOperation({ summary: 'แก้ไขกะการทำงาน' })
  updateShiftType(
    @Param('id') id: string,
    @Body() dto: Partial<CreateHrShiftTypeDto>,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.updateShiftType(req.user.tenantId, id, dto);
  }

  @Delete('shift-types/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ลบกะการทำงาน' })
  removeShiftType(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.removeShiftType(req.user.tenantId, id);
  }

  // ─── ALLOWANCE TYPES ──────────────────────────────────────────────────────

  @Get('allowance-types')
  @ApiOperation({ summary: 'ดึงรายการประเภทเบี้ยเลี้ยงทั้งหมด' })
  findAllAllowanceTypes(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.findAllAllowanceTypes(req.user.tenantId);
  }

  @Post('allowance-types')
  @ApiOperation({ summary: 'เพิ่มประเภทเบี้ยเลี้ยงใหม่' })
  createAllowanceType(
    @Body() dto: CreateHrAllowanceTypeDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.createAllowanceType(req.user.tenantId, dto);
  }

  @Patch('allowance-types/:id')
  @ApiOperation({ summary: 'แก้ไขประเภทเบี้ยเลี้ยง' })
  updateAllowanceType(
    @Param('id') id: string,
    @Body() dto: Partial<CreateHrAllowanceTypeDto>,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.updateAllowanceType(req.user.tenantId, id, dto);
  }

  @Delete('allowance-types/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ลบประเภทเบี้ยเลี้ยง' })
  removeAllowanceType(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.removeAllowanceType(req.user.tenantId, id);
  }

  // ─── DEDUCTION TYPES ──────────────────────────────────────────────────────

  @Get('deduction-types')
  @ApiOperation({ summary: 'ดึงรายการประเภทการหักเงินทั้งหมด' })
  findAllDeductionTypes(@Request() req: Express.Request & { user: { tenantId: string } }) {
    return this.hrMasterDataService.findAllDeductionTypes(req.user.tenantId);
  }

  @Post('deduction-types')
  @ApiOperation({ summary: 'เพิ่มประเภทการหักเงินใหม่' })
  createDeductionType(
    @Body() dto: CreateHrDeductionTypeDto,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.createDeductionType(req.user.tenantId, dto);
  }

  @Patch('deduction-types/:id')
  @ApiOperation({ summary: 'แก้ไขประเภทการหักเงิน' })
  updateDeductionType(
    @Param('id') id: string,
    @Body() dto: Partial<CreateHrDeductionTypeDto>,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.updateDeductionType(req.user.tenantId, id, dto);
  }

  @Delete('deduction-types/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ลบประเภทการหักเงิน' })
  removeDeductionType(
    @Param('id') id: string,
    @Request() req: Express.Request & { user: { tenantId: string } },
  ) {
    return this.hrMasterDataService.removeDeductionType(req.user.tenantId, id);
  }
}
