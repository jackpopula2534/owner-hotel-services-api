import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  SendEmailDto,
  SendBulkEmailDto,
  EmailHistoryQueryDto,
  EmailTemplate,
} from './dto/send-email.dto';

export interface EmailJobData {
  to: string;
  subject: string;
  template: EmailTemplate;
  context: Record<string, any>;
  language: string;
  tenantId?: string;
  emailLogId?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private templates: Map<string, handlebars.TemplateDelegate> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.initializeTransporter();
    await this.loadTemplates();
    this.registerHandlebarsHelpers();
  }

  private async initializeTransporter() {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT', 587);
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    const smtpSecure = this.configService.get<boolean>('SMTP_SECURE', false);

    if (!smtpHost || !smtpUser || !smtpPass) {
      this.logger.warn('SMTP configuration not complete. Email sending disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
    } catch (error) {
      this.logger.error('SMTP connection failed:', error.message);
    }
  }

  private async loadTemplates() {
    const templatesDir = path.join(__dirname, 'templates');

    if (!fs.existsSync(templatesDir)) {
      this.logger.warn('Templates directory not found. Creating default templates...');
      fs.mkdirSync(templatesDir, { recursive: true });
      await this.createDefaultTemplates(templatesDir);
    }

    const languages = ['th', 'en'];
    for (const template of Object.values(EmailTemplate)) {
      for (const lang of languages) {
        const templatePath = path.join(templatesDir, `${template}.${lang}.hbs`);
        if (fs.existsSync(templatePath)) {
          const templateContent = fs.readFileSync(templatePath, 'utf-8');
          this.templates.set(`${template}.${lang}`, handlebars.compile(templateContent));
        }
      }
      // Load fallback template without language suffix
      const fallbackPath = path.join(templatesDir, `${template}.hbs`);
      if (fs.existsSync(fallbackPath)) {
        const templateContent = fs.readFileSync(fallbackPath, 'utf-8');
        this.templates.set(template, handlebars.compile(templateContent));
      }
    }

    this.logger.log(`Loaded ${this.templates.size} email templates`);
  }

  private async createDefaultTemplates(templatesDir: string) {
    const baseTemplate = this.getBaseTemplate();

    const defaultTemplates: Record<string, { th: string; en: string }> = {
      [EmailTemplate.BOOKING_CONFIRMATION]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>ยืนยันการจอง</h2>
          <p>เรียน {{guestName}},</p>
          <p>ขอบคุณสำหรับการจองห้องพักกับเรา</p>
          <div class="details">
            <p><strong>รหัสการจอง:</strong> {{bookingId}}</p>
            <p><strong>วันเช็คอิน:</strong> {{checkInDate}}</p>
            <p><strong>วันเช็คเอาท์:</strong> {{checkOutDate}}</p>
            <p><strong>ประเภทห้อง:</strong> {{roomType}}</p>
            <p><strong>ราคารวม:</strong> ฿{{totalPrice}}</p>
          </div>
          <p>หากมีคำถามใดๆ กรุณาติดต่อเรา</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Booking Confirmation</h2>
          <p>Dear {{guestName}},</p>
          <p>Thank you for booking with us.</p>
          <div class="details">
            <p><strong>Booking ID:</strong> {{bookingId}}</p>
            <p><strong>Check-in:</strong> {{checkInDate}}</p>
            <p><strong>Check-out:</strong> {{checkOutDate}}</p>
            <p><strong>Room Type:</strong> {{roomType}}</p>
            <p><strong>Total Price:</strong> ฿{{totalPrice}}</p>
          </div>
          <p>If you have any questions, please contact us.</p>
        `,
        ),
      },
      [EmailTemplate.CHECK_IN_REMINDER]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>แจ้งเตือนการเช็คอิน</h2>
          <p>เรียน {{guestName}},</p>
          <p>เราตั้งตารอต้อนรับคุณพรุ่งนี้!</p>
          <div class="details">
            <p><strong>รหัสการจอง:</strong> {{bookingId}}</p>
            <p><strong>วันเช็คอิน:</strong> {{checkInDate}}</p>
            <p><strong>เวลาเช็คอิน:</strong> {{checkInTime}}</p>
          </div>
          <p>กรุณาเตรียมบัตรประชาชนหรือพาสปอร์ตมาด้วยนะคะ</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Check-in Reminder</h2>
          <p>Dear {{guestName}},</p>
          <p>We look forward to welcoming you tomorrow!</p>
          <div class="details">
            <p><strong>Booking ID:</strong> {{bookingId}}</p>
            <p><strong>Check-in Date:</strong> {{checkInDate}}</p>
            <p><strong>Check-in Time:</strong> {{checkInTime}}</p>
          </div>
          <p>Please bring your ID or passport.</p>
        `,
        ),
      },
      [EmailTemplate.CHECK_IN_CONFIRMATION]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>ยืนยันการเช็คอิน</h2>
          <p>เรียน {{guestName}},</p>
          <p>ยินดีต้อนรับสู่ {{hotelName}}!</p>
          <div class="details">
            <p><strong>รหัสการจอง:</strong> {{bookingId}}</p>
            <p><strong>ห้องพัก:</strong> {{roomNumber}}</p>
            <p><strong>วันเช็คอิน:</strong> {{checkInDate}}</p>
            <p><strong>วันเช็คเอาท์:</strong> {{checkOutDate}}</p>
          </div>
          <p>หากมีคำถามใดๆ กรุณาติดต่อฝ่ายพนักงานต้อนรับของเรา</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Check-in Confirmed</h2>
          <p>Dear {{guestName}},</p>
          <p>Welcome to {{hotelName}}!</p>
          <div class="details">
            <p><strong>Booking ID:</strong> {{bookingId}}</p>
            <p><strong>Room:</strong> {{roomNumber}}</p>
            <p><strong>Check-in Date:</strong> {{checkInDate}}</p>
            <p><strong>Check-out Date:</strong> {{checkOutDate}}</p>
          </div>
          <p>If you have any questions, please contact our front desk.</p>
        `,
        ),
      },
      [EmailTemplate.PAYMENT_RECEIPT]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>ใบเสร็จรับเงิน</h2>
          <p>เรียน {{guestName}},</p>
          <p>เราได้รับการชำระเงินของคุณเรียบร้อยแล้ว</p>
          <div class="details">
            <p><strong>เลขที่ใบเสร็จ:</strong> {{receiptNo}}</p>
            <p><strong>รหัสการจอง:</strong> {{bookingId}}</p>
            <p><strong>วันที่ชำระ:</strong> {{paymentDate}}</p>
            <p><strong>จำนวนเงิน:</strong> ฿{{amount}}</p>
            <p><strong>วิธีการชำระ:</strong> {{paymentMethod}}</p>
          </div>
          <p>ขอบคุณที่ใช้บริการ</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Payment Receipt</h2>
          <p>Dear {{guestName}},</p>
          <p>We have received your payment successfully.</p>
          <div class="details">
            <p><strong>Receipt No:</strong> {{receiptNo}}</p>
            <p><strong>Booking ID:</strong> {{bookingId}}</p>
            <p><strong>Payment Date:</strong> {{paymentDate}}</p>
            <p><strong>Amount:</strong> ฿{{amount}}</p>
            <p><strong>Payment Method:</strong> {{paymentMethod}}</p>
          </div>
          <p>Thank you for your business.</p>
        `,
        ),
      },
      [EmailTemplate.PASSWORD_RESET]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>รีเซ็ตรหัสผ่าน</h2>
          <p>เรียนคุณ {{userName}},</p>
          <p>เราได้รับคำขอรีเซ็ตรหัสผ่านของคุณ</p>
          <p>กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p>
          <a href="{{resetLink}}" class="button">รีเซ็ตรหัสผ่าน</a>
          <p>ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง</p>
          <p>หากคุณไม่ได้ขอรีเซ็ตรหัสผ่าน กรุณาเพิกเฉยอีเมลนี้</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Password Reset</h2>
          <p>Dear {{userName}},</p>
          <p>We received a request to reset your password.</p>
          <p>Click the button below to set a new password:</p>
          <a href="{{resetLink}}" class="button">Reset Password</a>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, please ignore this email.</p>
        `,
        ),
      },
      [EmailTemplate.WELCOME]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>ยินดีต้อนรับ!</h2>
          <p>เรียน {{guestName}},</p>
          <p>ขอบคุณที่ลงทะเบียนกับเรา</p>
          <p>คุณสามารถเข้าสู่ระบบได้ที่:</p>
          <a href="{{loginLink}}" class="button">เข้าสู่ระบบ</a>
          <p>หากมีคำถามใดๆ กรุณาติดต่อเรา</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Welcome!</h2>
          <p>Dear {{guestName}},</p>
          <p>Thank you for registering with us.</p>
          <p>You can login at:</p>
          <a href="{{loginLink}}" class="button">Login</a>
          <p>If you have any questions, please contact us.</p>
        `,
        ),
      },
      [EmailTemplate.CANCELLATION]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>ยกเลิกการจอง</h2>
          <p>เรียน {{guestName}},</p>
          <p>การจองของคุณได้ถูกยกเลิกเรียบร้อยแล้ว</p>
          <div class="details">
            <p><strong>รหัสการจอง:</strong> {{bookingId}}</p>
            <p><strong>วันที่ยกเลิก:</strong> {{cancellationDate}}</p>
            {{#if refundAmount}}
            <p><strong>จำนวนเงินคืน:</strong> ฿{{refundAmount}}</p>
            {{/if}}
          </div>
          <p>หากมีคำถามใดๆ กรุณาติดต่อเรา</p>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Booking Cancellation</h2>
          <p>Dear {{guestName}},</p>
          <p>Your booking has been cancelled.</p>
          <div class="details">
            <p><strong>Booking ID:</strong> {{bookingId}}</p>
            <p><strong>Cancellation Date:</strong> {{cancellationDate}}</p>
            {{#if refundAmount}}
            <p><strong>Refund Amount:</strong> ฿{{refundAmount}}</p>
            {{/if}}
          </div>
          <p>If you have any questions, please contact us.</p>
        `,
        ),
      },
      [EmailTemplate.INVOICE]: {
        th: this.wrapInBase(
          baseTemplate,
          `
          <h2>ใบแจ้งหนี้</h2>
          <p>เรียน {{customerName}},</p>
          <p>แนบมาพร้อมนี้คือใบแจ้งหนี้ของคุณ</p>
          <div class="details">
            <p><strong>เลขที่ใบแจ้งหนี้:</strong> {{invoiceNo}}</p>
            <p><strong>วันที่ออก:</strong> {{issueDate}}</p>
            <p><strong>กำหนดชำระ:</strong> {{dueDate}}</p>
            <p><strong>จำนวนเงิน:</strong> ฿{{amount}}</p>
          </div>
          <a href="{{paymentLink}}" class="button">ชำระเงิน</a>
        `,
        ),
        en: this.wrapInBase(
          baseTemplate,
          `
          <h2>Invoice</h2>
          <p>Dear {{customerName}},</p>
          <p>Please find your invoice attached.</p>
          <div class="details">
            <p><strong>Invoice No:</strong> {{invoiceNo}}</p>
            <p><strong>Issue Date:</strong> {{issueDate}}</p>
            <p><strong>Due Date:</strong> {{dueDate}}</p>
            <p><strong>Amount:</strong> ฿{{amount}}</p>
          </div>
          <a href="{{paymentLink}}" class="button">Pay Now</a>
        `,
        ),
      },
    };

    for (const [templateName, languages] of Object.entries(defaultTemplates)) {
      fs.writeFileSync(path.join(templatesDir, `${templateName}.th.hbs`), languages.th);
      fs.writeFileSync(path.join(templatesDir, `${templateName}.en.hbs`), languages.en);
    }
  }

  private getBaseTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 30px 20px; }
    .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .details p { margin: 8px 0; }
    .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
    .footer a { color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{hotelName}}</h1>
    </div>
    <div class="content">
      {{content}}
    </div>
    <div class="footer">
      <p>{{hotelName}} | {{hotelAddress}}</p>
      <p>โทร: {{hotelPhone}} | อีเมล: {{hotelEmail}}</p>
      <p><a href="{{unsubscribeLink}}">ยกเลิกการรับอีเมล</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  private wrapInBase(base: string, content: string): string {
    return base.replace('{{content}}', content);
  }

  private registerHandlebarsHelpers() {
    handlebars.registerHelper('formatDate', (date: Date | string) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    });

    handlebars.registerHelper('formatCurrency', (amount: number) => {
      if (!amount) return '0.00';
      return amount.toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    });

    handlebars.registerHelper('ifEquals', function (arg1: any, arg2: any, options: any) {
      return arg1 === arg2 ? options.fn(this) : options.inverse(this);
    });
  }

  async sendEmail(dto: SendEmailDto): Promise<{ success: boolean; emailLogId: string }> {
    const emailLog = await this.prisma.emailLog.create({
      data: {
        tenantId: dto.tenantId,
        recipient: dto.to,
        subject: dto.subject,
        template: dto.template,
        status: 'queued',
        metadata: dto.context ? JSON.parse(JSON.stringify(dto.context)) : null,
      },
    });

    await this.emailQueue.add('send', {
      to: dto.to,
      subject: dto.subject,
      template: dto.template,
      context: dto.context || {},
      language: dto.language || 'th',
      tenantId: dto.tenantId,
      emailLogId: emailLog.id,
    } as EmailJobData);

    return { success: true, emailLogId: emailLog.id };
  }

  async sendBulkEmail(
    dto: SendBulkEmailDto,
  ): Promise<{ success: boolean; count: number; emailLogIds: string[] }> {
    const emailLogIds: string[] = [];

    for (const recipient of dto.recipients) {
      const mergedContext = { ...dto.commonContext, ...recipient.context };

      const emailLog = await this.prisma.emailLog.create({
        data: {
          tenantId: dto.tenantId,
          recipient: recipient.to,
          subject: dto.subject,
          template: dto.template,
          status: 'queued',
          metadata: mergedContext ? JSON.parse(JSON.stringify(mergedContext)) : null,
        },
      });

      emailLogIds.push(emailLog.id);

      await this.emailQueue.add('send', {
        to: recipient.to,
        subject: dto.subject,
        template: dto.template,
        context: mergedContext,
        language: dto.language || 'th',
        tenantId: dto.tenantId,
        emailLogId: emailLog.id,
      } as EmailJobData);
    }

    return { success: true, count: dto.recipients.length, emailLogIds };
  }

  async processEmail(jobData: EmailJobData): Promise<void> {
    const { to, subject, template, context, language, emailLogId } = jobData;

    if (!this.transporter) {
      this.logger.warn('Email transporter not initialized. Skipping email send.');
      if (emailLogId) {
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: { status: 'failed', errorMsg: 'SMTP not configured' },
        });
      }
      return;
    }

    try {
      const templateKey = `${template}.${language}` || template;
      let compiledTemplate = this.templates.get(templateKey);

      if (!compiledTemplate) {
        compiledTemplate = this.templates.get(template);
      }

      if (!compiledTemplate) {
        throw new Error(`Template not found: ${template}`);
      }

      const html = compiledTemplate({
        ...context,
        hotelName: context.hotelName || this.configService.get('APP_NAME', 'Hotel Services'),
        hotelAddress: context.hotelAddress || '',
        hotelPhone: context.hotelPhone || '',
        hotelEmail: context.hotelEmail || this.configService.get('SMTP_FROM_EMAIL', ''),
        unsubscribeLink: context.unsubscribeLink || '#',
      });

      const fromEmail = this.configService.get('SMTP_FROM_EMAIL', 'noreply@hotel.com');
      const fromName = this.configService.get('SMTP_FROM_NAME', 'Hotel Services');

      await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
      });

      if (emailLogId) {
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: { status: 'sent', sentAt: new Date() },
        });
      }

      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error.message);

      if (emailLogId) {
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: { status: 'failed', errorMsg: error.message },
        });
      }

      throw error;
    }
  }

  async getEmailHistory(query: EmailHistoryQueryDto, tenantId?: string) {
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (query.recipient) {
      where.recipient = { contains: query.recipient };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.template) {
      where.template = query.template;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.emailLog.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTemplateList() {
    return Object.values(EmailTemplate).map((template) => ({
      name: template,
      hasThaiVersion: this.templates.has(`${template}.th`),
      hasEnglishVersion: this.templates.has(`${template}.en`),
    }));
  }

  async resendEmail(emailLogId: string): Promise<{ success: boolean }> {
    const emailLog = await this.prisma.emailLog.findUnique({
      where: { id: emailLogId },
    });

    if (!emailLog) {
      throw new Error('Email log not found');
    }

    await this.prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: 'queued' },
    });

    await this.emailQueue.add('send', {
      to: emailLog.recipient,
      subject: emailLog.subject,
      template: emailLog.template as EmailTemplate,
      context: (emailLog.metadata as Record<string, any>) || {},
      language: 'th',
      tenantId: emailLog.tenantId,
      emailLogId: emailLog.id,
    } as EmailJobData);

    return { success: true };
  }

  // Convenience methods for sending specific email types
  async sendBookingConfirmation(params: {
    to: string;
    guestName: string;
    bookingId: string;
    checkInDate: string;
    checkOutDate: string;
    roomType: string;
    totalPrice: number;
    tenantId?: string;
    hotelName?: string;
  }) {
    return this.sendEmail({
      to: params.to,
      subject: 'ยืนยันการจองห้องพัก - Booking Confirmation',
      template: EmailTemplate.BOOKING_CONFIRMATION,
      context: params,
      tenantId: params.tenantId,
    });
  }

  async sendCheckInReminder(params: {
    to: string;
    guestName: string;
    bookingId: string;
    checkInDate: string;
    checkInTime: string;
    tenantId?: string;
    hotelName?: string;
  }) {
    return this.sendEmail({
      to: params.to,
      subject: 'แจ้งเตือนการเช็คอิน - Check-in Reminder',
      template: EmailTemplate.CHECK_IN_REMINDER,
      context: params,
      tenantId: params.tenantId,
    });
  }

  async sendPaymentReceipt(params: {
    to: string;
    guestName: string;
    receiptNo: string;
    bookingId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: string;
    tenantId?: string;
    hotelName?: string;
  }) {
    return this.sendEmail({
      to: params.to,
      subject: 'ใบเสร็จรับเงิน - Payment Receipt',
      template: EmailTemplate.PAYMENT_RECEIPT,
      context: params,
      tenantId: params.tenantId,
    });
  }

  async sendPasswordReset(params: { to: string; userName: string; resetLink: string }) {
    return this.sendEmail({
      to: params.to,
      subject: 'รีเซ็ตรหัสผ่าน - Password Reset',
      template: EmailTemplate.PASSWORD_RESET,
      context: params,
    });
  }

  async sendCancellationEmail(params: {
    to: string;
    guestName: string;
    bookingId: string;
    cancellationDate: string;
    refundAmount?: number;
    tenantId?: string;
    hotelName?: string;
  }) {
    return this.sendEmail({
      to: params.to,
      subject: 'ยกเลิกการจอง - Booking Cancellation',
      template: EmailTemplate.CANCELLATION,
      context: params,
      tenantId: params.tenantId,
    });
  }

  // ==========================================
  // Email Preferences Management
  // ==========================================

  /**
   * Get email preferences for a user
   */
  async getEmailPreferences(email: string, tenantId?: string) {
    const preference = await this.prisma.emailPreference.findFirst({
      where: {
        email,
        tenantId: tenantId || null,
      },
    });

    if (!preference) {
      // Return default preferences if none exist
      return {
        id: null,
        email,
        bookingConfirmation: true,
        checkInReminder: true,
        checkOutReminder: true,
        paymentReceipt: true,
        promotionalEmails: false,
        newsletter: false,
        unsubscribedAt: null,
        createdAt: null,
        updatedAt: null,
      };
    }

    return preference;
  }

  /**
   * Update email preferences for a user
   */
  async updateEmailPreferences(
    email: string,
    preferences: {
      bookingConfirmation?: boolean;
      checkInReminder?: boolean;
      checkOutReminder?: boolean;
      paymentReceipt?: boolean;
      promotionalEmails?: boolean;
      newsletter?: boolean;
    },
    tenantId?: string,
    guestId?: string,
  ) {
    const existing = await this.prisma.emailPreference.findFirst({
      where: {
        email,
        tenantId: tenantId || null,
      },
    });

    if (existing) {
      // Update existing preferences
      return this.prisma.emailPreference.update({
        where: { id: existing.id },
        data: {
          ...preferences,
          unsubscribedAt: null, // Resubscribe if updating preferences
        },
      });
    }

    // Create new preferences
    return this.prisma.emailPreference.create({
      data: {
        email,
        tenantId,
        guestId,
        bookingConfirmation: preferences.bookingConfirmation ?? true,
        checkInReminder: preferences.checkInReminder ?? true,
        checkOutReminder: preferences.checkOutReminder ?? true,
        paymentReceipt: preferences.paymentReceipt ?? true,
        promotionalEmails: preferences.promotionalEmails ?? false,
        newsletter: preferences.newsletter ?? false,
      },
    });
  }

  /**
   * Unsubscribe from all emails
   */
  async unsubscribeFromEmails(email: string, tenantId?: string) {
    const existing = await this.prisma.emailPreference.findFirst({
      where: {
        email,
        tenantId: tenantId || null,
      },
    });

    if (existing) {
      return this.prisma.emailPreference.update({
        where: { id: existing.id },
        data: {
          unsubscribedAt: new Date(),
          bookingConfirmation: false,
          checkInReminder: false,
          checkOutReminder: false,
          paymentReceipt: false,
          promotionalEmails: false,
          newsletter: false,
        },
      });
    }

    // Create unsubscribed preference
    return this.prisma.emailPreference.create({
      data: {
        email,
        tenantId,
        unsubscribedAt: new Date(),
        bookingConfirmation: false,
        checkInReminder: false,
        checkOutReminder: false,
        paymentReceipt: false,
        promotionalEmails: false,
        newsletter: false,
      },
    });
  }

  /**
   * Resubscribe to emails (reset to defaults)
   */
  async resubscribeToEmails(email: string, tenantId?: string) {
    const existing = await this.prisma.emailPreference.findFirst({
      where: {
        email,
        tenantId: tenantId || null,
      },
    });

    if (existing) {
      return this.prisma.emailPreference.update({
        where: { id: existing.id },
        data: {
          unsubscribedAt: null,
          bookingConfirmation: true,
          checkInReminder: true,
          checkOutReminder: true,
          paymentReceipt: true,
          promotionalEmails: false,
          newsletter: false,
        },
      });
    }

    // Create default preferences
    return this.prisma.emailPreference.create({
      data: {
        email,
        tenantId,
        bookingConfirmation: true,
        checkInReminder: true,
        checkOutReminder: true,
        paymentReceipt: true,
        promotionalEmails: false,
        newsletter: false,
      },
    });
  }

  /**
   * Check if email is unsubscribed
   */
  async isUnsubscribed(email: string, tenantId?: string): Promise<boolean> {
    const preference = await this.prisma.emailPreference.findFirst({
      where: {
        email,
        tenantId: tenantId || null,
      },
    });

    return preference?.unsubscribedAt !== null && preference?.unsubscribedAt !== undefined;
  }
}
