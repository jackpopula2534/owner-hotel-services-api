import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  filename: string;
  path: string;
}

@ApiTags('Bank Accounts')
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  // ─── Public endpoint (แสดงรายการบัญชีที่ active สำหรับหน้า billing) ─────────

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'List active bank accounts (public)' })
  @ApiResponse({ status: 200, description: 'Active bank accounts' })
  findAllPublic() {
    return this.bankAccountsService.findAllPublic();
  }

  // ─── Admin endpoints ──────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: '[Admin] List all bank accounts' })
  findAll() {
    return this.bankAccountsService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: '[Admin] Get bank account by ID' })
  findOne(@Param('id') id: string) {
    return this.bankAccountsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: '[Admin] Create bank account' })
  @ApiResponse({ status: 201, description: 'Bank account created' })
  create(@Body() dto: CreateBankAccountDto) {
    return this.bankAccountsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: '[Admin] Update bank account' })
  update(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.bankAccountsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: '[Admin] Delete bank account' })
  remove(@Param('id') id: string) {
    return this.bankAccountsService.remove(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Put('reorder')
  @ApiOperation({ summary: '[Admin] Reorder bank accounts by IDs array' })
  reorder(@Body('ids') ids: string[]) {
    return this.bankAccountsService.reorder(ids);
  }

  // ─── Logo upload ──────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin')
  @ApiBearerAuth()
  @Post('upload-logo')
  @ApiOperation({ summary: '[Admin] Upload bank logo image' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Logo uploaded, returns { url }' })
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'banks');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `bank-${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif|svg\+xml)$/)) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  uploadLogo(@UploadedFile() file: MulterFile) {
    if (!file) throw new BadRequestException('No file provided');
    const baseUrl =
      process.env.API_BASE_URL ||
      `http://localhost:${process.env.PORT || 9011}`;
    return { url: `${baseUrl}/uploads/banks/${file.filename}` };
  }
}
