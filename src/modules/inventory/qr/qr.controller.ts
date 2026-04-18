import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { QRService } from './qr.service';
import { ResolveQRDto } from './dto/resolve-qr.dto';

@ApiTags('Inventory QR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class QRController {
  constructor(private readonly qrService: QRService) {}

  @ApiOperation({ summary: 'Get QR code for an inventory item (PNG or SVG)' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiQuery({ name: 'format', enum: ['png', 'svg'], required: false })
  @ApiQuery({ name: 'size', required: false, description: 'QR size in pixels (default 256)' })
  @Get('items/:id/qr')
  async getItemQR(
    @Request() req: any,
    @Param('id') id: string,
    @Query('format') format: 'png' | 'svg' = 'png',
    @Query('size', new DefaultValuePipe(256), ParseIntPipe) size: number,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.qrService.getItemQR(req.user.tenantId, id, format, size);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  }

  @ApiOperation({ summary: 'Get PDF label sheet for an inventory item' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiQuery({ name: 'count', required: false, description: 'Number of labels (default 12)' })
  @Get('items/:id/labels')
  async getItemLabels(
    @Request() req: any,
    @Param('id') id: string,
    @Query('count', new DefaultValuePipe(12), ParseIntPipe) count: number,
    @Res() res: Response,
  ) {
    const pdf = await this.qrService.getItemLabelsPDF(req.user.tenantId, id, count);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="labels-${id}.pdf"`);
    res.send(pdf);
  }

  @ApiOperation({ summary: 'Get QR code for an inventory lot (PNG or SVG)' })
  @ApiParam({ name: 'id', description: 'Lot UUID' })
  @ApiQuery({ name: 'format', enum: ['png', 'svg'], required: false })
  @ApiQuery({ name: 'size', required: false })
  @Get('lots/:id/qr')
  async getLotQR(
    @Request() req: any,
    @Param('id') id: string,
    @Query('format') format: 'png' | 'svg' = 'png',
    @Query('size', new DefaultValuePipe(256), ParseIntPipe) size: number,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.qrService.getLotQR(req.user.tenantId, id, format, size);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  }

  @ApiOperation({ summary: 'Get PDF label for a specific lot' })
  @ApiParam({ name: 'id', description: 'Lot UUID' })
  @ApiQuery({ name: 'count', required: false, description: 'Number of labels (default 1)' })
  @Get('lots/:id/labels')
  async getLotLabels(
    @Request() req: any,
    @Param('id') id: string,
    @Query('count', new DefaultValuePipe(1), ParseIntPipe) count: number,
    @Res() res: Response,
  ) {
    const pdf = await this.qrService.getLotLabelsPDF(req.user.tenantId, id, count);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="lot-label-${id}.pdf"`);
    res.send(pdf);
  }

  @ApiOperation({ summary: 'Resolve QR payload → item or lot detail (verifies HMAC)' })
  @ApiResponse({ status: 200, description: 'Item or lot detail' })
  @ApiResponse({ status: 400, description: 'Invalid or tampered QR' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })  // 10 req/min strict limit
  @Post('qr/resolve')
  async resolveQR(@Request() req: any, @Body() dto: ResolveQRDto) {
    return this.qrService.resolveQR(req.user.tenantId, dto.payload);
  }
}
