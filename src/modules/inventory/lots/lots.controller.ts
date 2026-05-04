import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { LotsService } from './lots.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { QueryLotDto } from './dto/query-lot.dto';
import { QuarantineLotDto, ReleaseLotDto, DisposeLotDto } from './dto/quarantine-lot.dto';

@ApiTags('Inventory Lots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory/lots')
export class LotsController {
  constructor(private readonly lotsService: LotsService) {}

  @ApiOperation({ summary: 'List lots with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated lot list' })
  @Get()
  findAll(@Request() req: any, @Query() query: QueryLotDto) {
    return this.lotsService.findAll(req.user.tenantId, query);
  }

  @ApiOperation({ summary: 'Create a new inventory lot' })
  @ApiResponse({ status: 201, description: 'Lot created' })
  @Post()
  create(@Request() req: any, @Body() dto: CreateLotDto) {
    return this.lotsService.create(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: 'Get lots expiring within N days' })
  @ApiQuery({ name: 'days', required: false, description: 'Days until expiry (default 30)' })
  @Get('near-expiry')
  findNearExpiry(
    @Request() req: any,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.lotsService.findNearExpiry(req.user.tenantId, days);
  }

  @ApiOperation({ summary: 'Get all expired lots not yet disposed' })
  @Get('expired')
  findExpired(@Request() req: any) {
    return this.lotsService.findExpired(req.user.tenantId);
  }

  @ApiOperation({ summary: 'Get lot detail by ID (with movement history)' })
  @ApiParam({ name: 'id', description: 'Lot UUID' })
  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.lotsService.findOne(req.user.tenantId, id);
  }

  @ApiOperation({ summary: 'Quarantine a lot (block from FEFO dispatch)' })
  @ApiParam({ name: 'id', description: 'Lot UUID' })
  @ApiResponse({ status: 200, description: 'Lot quarantined' })
  @ApiResponse({ status: 400, description: 'Lot is not in ACTIVE status' })
  @Post(':id/quarantine')
  @HttpCode(HttpStatus.OK)
  quarantine(@Request() req: any, @Param('id') id: string, @Body() dto: QuarantineLotDto) {
    return this.lotsService.quarantine(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Release a quarantined lot back to ACTIVE' })
  @ApiParam({ name: 'id', description: 'Lot UUID' })
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  release(@Request() req: any, @Param('id') id: string, @Body() dto: ReleaseLotDto) {
    return this.lotsService.release(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Dispose a lot (creates WASTE movement)' })
  @ApiParam({ name: 'id', description: 'Lot UUID' })
  @ApiResponse({ status: 200, description: 'Lot disposed, WASTE movement created' })
  @Post(':id/dispose')
  @HttpCode(HttpStatus.OK)
  dispose(@Request() req: any, @Param('id') id: string, @Body() dto: DisposeLotDto) {
    return this.lotsService.dispose(req.user.tenantId, id, dto, req.user.id);
  }
}

@ApiTags('Inventory Items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory/items')
export class ItemLotsController {
  constructor(private readonly lotsService: LotsService) {}

  @ApiOperation({ summary: 'Get all lots for a specific inventory item' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @Get(':id/lots')
  findByItem(@Request() req: any, @Param('id') id: string) {
    return this.lotsService.findByItem(req.user.tenantId, id);
  }
}
