import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { extname, join } from 'path';

/**
 * ไฟล์ที่รับเข้ามาจาก multer memoryStorage
 * (ต้องตั้ง storage: memoryStorage() ใน FileInterceptor เพื่อให้มี buffer)
 */
export interface UploadableFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface SaveFileOptions {
  /** โฟลเดอร์/prefix ปลายทาง เช่น 'payment-slips', 'camp', 'rooms' */
  folder: string;
  file: UploadableFile;
  /** prefix ชื่อไฟล์ (default = folder) เช่น 'slip' -> slip-<ts>-<rand>.jpg */
  prefix?: string;
}

export interface SavedFile {
  /** ชื่อไฟล์ที่ถูกสร้าง */
  filename: string;
  /** key เต็ม = folder/filename (ใช้ตอนลบไฟล์) */
  key: string;
  /**
   * path สำหรับเก็บลง DB
   * - local driver: relative path เช่น /uploads/camp/xxx.jpg
   * - s3/R2 driver: full public URL
   */
  path: string;
  /** absolute URL เปิดดูไฟล์ได้ตรง ๆ เสมอ */
  url: string;
}

type StorageDriver = 'local' | 's3';

/**
 * StorageService — abstraction กลางสำหรับไฟล์อัพโหลดทั้งระบบ
 *
 * dev:  STORAGE_DRIVER=local  -> เขียนลง ./uploads แล้ว serve ผ่าน /uploads (main.ts)
 * prod: STORAGE_DRIVER=s3     -> อัพขึ้น object storage (Cloudflare R2 / AWS S3 / DO Spaces)
 *
 * ทำไมต้องมี: ของเดิม multer.diskStorage เขียนลง local disk ของ container
 * พอ redeploy/scale หลาย instance ไฟล์หาย/หาไม่เจอ. ย้ายไป object storage แก้ทั้งสองปัญหา.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  // local
  private readonly localRoot: string;
  private readonly publicBaseUrl: string;

  // s3 / r2
  private s3Client: S3Client | null = null;
  private readonly bucket: string;
  private readonly s3PublicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.driver = (this.config.get<string>('STORAGE_DRIVER') ||
      'local') as StorageDriver;

    this.localRoot = join(process.cwd(), 'uploads');
    this.publicBaseUrl = (
      this.config.get<string>('API_BASE_URL') ||
      this.config.get<string>('APP_BASE_URL') ||
      `http://localhost:${this.config.get<string>('PORT') || 9011}`
    ).replace(/\/+$/, '');

    this.bucket = this.config.get<string>('S3_BUCKET') || '';
    this.s3PublicUrl = (this.config.get<string>('S3_PUBLIC_URL') || '').replace(
      /\/+$/,
      '',
    );
  }

  onModuleInit(): void {
    if (this.driver === 's3') {
      const endpoint = this.config.get<string>('S3_ENDPOINT'); // R2/Spaces ต้องระบุ, AWS S3 เว้นได้
      const region = this.config.get<string>('S3_REGION') || 'auto';
      const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID') || '';
      const secretAccessKey =
        this.config.get<string>('S3_SECRET_ACCESS_KEY') || '';

      this.s3Client = new S3Client({
        region,
        endpoint: endpoint || undefined,
        // R2/Spaces ต้องใช้ path-style; AWS S3 ใช้ virtual-host (false)
        forcePathStyle:
          this.config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log(
        `Storage driver = s3 (bucket=${this.bucket}, endpoint=${endpoint || 'aws-default'})`,
      );
    } else {
      if (!existsSync(this.localRoot)) {
        mkdirSync(this.localRoot, { recursive: true });
      }
      this.logger.log(`Storage driver = local (root=${this.localRoot})`);
    }
  }

  /** สร้างชื่อไฟล์ปลอดภัย ไม่ชนกัน */
  private buildFilename(opts: SaveFileOptions): string {
    const ext = extname(opts.file.originalname || '').toLowerCase();
    const prefix = (opts.prefix || opts.folder).replace(/[^a-zA-Z0-9_-]/g, '');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    return `${prefix}-${unique}${ext}`;
  }

  /**
   * บันทึกไฟล์ 1 ไฟล์ คืน metadata สำหรับเก็บลง DB
   */
  async save(opts: SaveFileOptions): Promise<SavedFile> {
    const filename = this.buildFilename(opts);
    const key = `${opts.folder}/${filename}`;

    if (this.driver === 's3') {
      if (!this.s3Client) {
        throw new Error('S3 client not initialized');
      }
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: opts.file.buffer,
          ContentType: opts.file.mimetype,
        }),
      );
      const url = `${this.s3PublicUrl}/${key}`;
      return { filename, key, path: url, url };
    }

    // local
    const dir = join(this.localRoot, opts.folder);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await writeFile(join(dir, filename), opts.file.buffer);
    const relative = `/uploads/${key}`;
    return {
      filename,
      key,
      path: relative,
      url: `${this.publicBaseUrl}${relative}`,
    };
  }

  /** บันทึกหลายไฟล์พร้อมกัน */
  async saveMany(
    files: UploadableFile[],
    opts: Omit<SaveFileOptions, 'file'>,
  ): Promise<SavedFile[]> {
    return Promise.all(files.map((file) => this.save({ ...opts, file })));
  }

  /**
   * สร้าง path สำหรับเก็บลง DB จาก key ที่ save() เคยคืนมา
   *
   * มีไว้ให้ flow แบบ 2 ขั้น (อัพโหลดก่อน → ค่อยบันทึกเอกสารทีหลัง) ฝั่ง client
   * ส่งกลับมาแค่ key ได้ แล้ว server ประกอบ URL เอง — ถ้าปล่อยให้ client ส่ง URL
   * มาตรง ๆ เท่ากับใครก็ฝัง URL ภายนอกลงในหลักฐานการเงินได้
   */
  publicPath(key: string): string {
    return this.driver === 's3'
      ? `${this.s3PublicUrl}/${key}`
      : `/uploads/${key}`;
  }

  /**
   * ลบไฟล์ตาม key (folder/filename). best-effort — ไม่ throw ถ้าลบไม่ได้
   */
  async remove(key: string): Promise<void> {
    try {
      if (this.driver === 's3' && this.s3Client) {
        await this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return;
      }
      const full = join(this.localRoot, key);
      if (existsSync(full)) {
        await unlink(full);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to remove file ${key}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  get activeDriver(): StorageDriver {
    return this.driver;
  }
}
