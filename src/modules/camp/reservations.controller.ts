import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '@/common/storage/storage.service';
import { ReservationsService } from './reservations.service';
import { CampAccountingService } from './camp-accounting.service';
import {
  AddExtraChargeDto,
  CancelReservationDto,
  CheckInReservationDto,
  CheckOutReservationDto,
  CreateReservationDto,
  RecordPaymentDto,
  UpdateReservationAddonsDto,
  UpdateReservationDto,
} from './dto/reservation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CAMP_READ_ROLES, CAMP_OPS_WRITE_ROLES } from './camp-roles';


interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  filename: string;
}

@ApiTags('camp-reservations')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/reservations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CAMP_MODULE')
export class ReservationsController {
  constructor(
    private readonly service: ReservationsService,
    private readonly storage: StorageService,
    private readonly campAccounting: CampAccountingService,
  ) {}

  /**
   * สร้าง Journal Entry ย้อนหลังให้การรับชำระของลานที่เกิดก่อนมีการลงบัญชีอัตโนมัติ
   * คู่กับปุ่ม Backfill ฝั่งโรงแรม (bookings/admin/backfill-journal-entries)
   */
  @Post('admin/backfill-journal-entries')
  @ApiOperation({ summary: 'Backfill journal entries for camp payments with no accounting entry' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  backfillJournalEntries(@CurrentUser() user: { id?: string; tenantId?: string }) {
    return this.campAccounting.backfillJournals(user?.tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'List reservations' })
  @Roles(...CAMP_READ_ROLES)
  findAll(
    @Query('campgroundId') campgroundId: string,
    @Query('status') status: string,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.findAll({ campgroundId, status }, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reservation by id' })
  @Roles(...CAMP_READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: { id?: string; tenantId?: string }) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create reservation (prevents double-booking)' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  create(@Body() dto: CreateReservationDto, @CurrentUser() user: { id?: string; tenantId?: string }) {
    return this.service.create(dto, user?.tenantId, { actorId: user?.id });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update reservation' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReservationDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.update(id, dto, user?.tenantId, user?.id);
  }

  @Put(':id/addons')
  @ApiOperation({
    summary: 'Replace reservation add-ons (stock-aware; recalculates total)',
  })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  updateAddons(
    @Param('id') id: string,
    @Body() dto: UpdateReservationAddonsDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.updateAddons(id, dto, user?.tenantId, user?.id);
  }

  @Post(':id/check-in')
  @ApiOperation({ summary: 'Check-in reservation' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  checkIn(
    @Param('id') id: string,
    @Body() dto: CheckInReservationDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.checkIn(id, user?.tenantId, dto ?? {}, user?.id);
  }

  @Post(':id/check-out')
  @ApiOperation({ summary: 'Check-out reservation' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  checkOut(
    @Param('id') id: string,
    @Body() dto: CheckOutReservationDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.checkOut(id, user?.tenantId, dto ?? {}, user?.id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel reservation' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelReservationDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.cancel(id, user?.tenantId, dto ?? {}, user?.id);
  }

  @Post(':id/charges')
  @ApiOperation({ summary: 'Add an extra charge (damage, extra guest, adjustment) to the bill' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  addCharge(
    @Param('id') id: string,
    @Body() dto: AddExtraChargeDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.addCharge(id, dto, user?.tenantId, user?.id);
  }

  @Delete(':id/charges/:chargeId')
  @ApiOperation({ summary: 'Remove an extra charge from an open bill' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  removeCharge(
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.removeCharge(id, chargeId, user?.tenantId, user?.id);
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Record a payment against a reservation' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.service.recordPayment(id, dto, user?.tenantId, user?.id);
  }

  @Post(':id/payment-slip')
  @ApiOperation({ summary: 'Upload a bank-transfer slip image; returns its URL to attach on /payment' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Slip uploaded' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(new BadRequestException('อัปโหลดได้เฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadPaymentSlip(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('ไม่พบไฟล์สลิป');
    }
    const saved = await this.storage.save({
      folder: 'camp',
      file,
      prefix: `slip-${id}`,
    });
    const slipUrl = saved.url;
    return this.service.attachSlipUrl(id, slipUrl, user?.tenantId);
  }
}
