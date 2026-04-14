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
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Simple interface for multer file to avoid @types/multer dependency
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

@ApiTags('rooms')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'rooms', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all rooms' })
  @ApiResponse({ status: 200, description: 'List of rooms' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.roomsService.findAll(query, user?.tenantId);
  }

  @Get('available')
  @ApiOperation({ summary: 'Get available rooms for date range with optional time override' })
  @ApiResponse({ status: 200, description: 'List of available rooms' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async getAvailableRooms(
    @Query('checkIn') checkIn: string,
    @Query('checkOut') checkOut: string,
    @CurrentUser() user: { tenantId?: string },
    @Query('propertyId') propertyId?: string,
    @Query('checkInTime') checkInTime?: string,
    @Query('checkOutTime') checkOutTime?: string,
  ) {
    return this.roomsService.getAvailableRooms(
      checkIn,
      checkOut,
      propertyId,
      user?.tenantId,
      checkInTime,
      checkOutTime,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get room by ID' })
  @ApiResponse({ status: 200, description: 'Room details' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.roomsService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new room' })
  @ApiResponse({ status: 201, description: 'Room created successfully' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  async create(@Body() createRoomDto: CreateRoomDto, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.roomsService.create(createRoomDto, user?.tenantId, user?.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update room' })
  @ApiResponse({ status: 200, description: 'Room updated successfully' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  async update(
    @Param('id') id: string,
    @Body() updateRoomDto: UpdateRoomDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.roomsService.update(id, updateRoomDto, user?.tenantId, user?.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update room status' })
  @ApiResponse({ status: 200, description: 'Room status updated' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.roomsService.updateStatus(id, status, user?.tenantId, user?.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete room' })
  @ApiResponse({ status: 200, description: 'Room deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.roomsService.remove(id, user?.tenantId, user?.id);
  }

  @Post(':id/images')
  @ApiOperation({ summary: 'Upload room images' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded successfully' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  @UseInterceptors(
    FilesInterceptor('images', 8, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'rooms');
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const roomId = req.params.id;
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname);
          cb(null, `room-${roomId}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    }),
  )
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: MulterFile[],
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No image files provided');
    }

    // Build URL paths for the uploaded images
    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 9011}`;
    const imageUrls = files.map((file) => `${baseUrl}/uploads/rooms/${file.filename}`);

    // Fetch current room and append new images to existing ones
    // Note: Prisma type doesn't reflect `images` yet — regenerate after migration
    const room = await this.roomsService.findOne(id, user?.tenantId);
    const roomAny = room as unknown as Record<string, unknown>;
    const existingImages: string[] = Array.isArray(roomAny.images) ? (roomAny.images as string[]) : [];
    const updatedImages = [...existingImages, ...imageUrls].slice(0, 8);

    return this.roomsService.update(id, { images: updatedImages }, user?.tenantId, user?.id);
  }
}
