import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateAnalyticsEventDto {
  @IsString()
  eventName: string;

  @IsObject()
  @IsOptional()
  metadata?: any;
}
