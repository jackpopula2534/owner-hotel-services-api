import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  MinLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MessageChannel {
  LINE = 'LINE',
  FACEBOOK = 'FACEBOOK',
  ALL = 'ALL',
}

export enum MessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum AutoReplyTriggerType {
  KEYWORD = 'KEYWORD',
  GREETING = 'GREETING',
  OUT_OF_HOURS = 'OUT_OF_HOURS',
  FALLBACK = 'FALLBACK',
}

// ─── Reply to Conversation ─────────────────────────────────────────────────────

export class SendReplyDto {
  @ApiProperty({ description: 'Conversation ID' })
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @ApiProperty({ description: 'ข้อความที่จะส่ง' })
  @IsString()
  @MinLength(1)
  content: string;
}

// ─── Conversation Query ────────────────────────────────────────────────────────

export class ConversationQueryDto {
  @ApiPropertyOptional({ enum: MessageChannel })
  @IsOptional()
  @IsEnum(MessageChannel)
  channel?: MessageChannel;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

// ─── Auto-Reply Template ──────────────────────────────────────────────────────

export class CreateAutoReplyTemplateDto {
  @ApiProperty({ example: 'ตอบรับนอกเวลา' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ enum: MessageChannel, default: MessageChannel.ALL })
  @IsOptional()
  @IsEnum(MessageChannel)
  channel?: MessageChannel = MessageChannel.ALL;

  @ApiPropertyOptional({ enum: AutoReplyTriggerType, default: AutoReplyTriggerType.KEYWORD })
  @IsOptional()
  @IsEnum(AutoReplyTriggerType)
  triggerType?: AutoReplyTriggerType = AutoReplyTriggerType.KEYWORD;

  @ApiPropertyOptional({ type: [String], example: ['ราคา', 'ห้องว่าง', 'จอง'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiProperty({ example: 'ขอบคุณที่ติดต่อมาค่ะ ทางโรงแรมจะตอบกลับภายใน 15 นาทีค่ะ' })
  @IsString()
  @IsNotEmpty()
  replyText: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number = 0;
}

export class UpdateAutoReplyTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: MessageChannel })
  @IsOptional()
  @IsEnum(MessageChannel)
  channel?: MessageChannel;

  @ApiPropertyOptional({ enum: AutoReplyTriggerType })
  @IsOptional()
  @IsEnum(AutoReplyTriggerType)
  triggerType?: AutoReplyTriggerType;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  replyText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

// ─── LINE Webhook (internal types) ────────────────────────────────────────────

export interface LineWebhookEvent {
  type: string;
  source: {
    type: string;
    userId: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: string;
    text?: string;
  };
  replyToken?: string;
  timestamp: number;
}

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}
