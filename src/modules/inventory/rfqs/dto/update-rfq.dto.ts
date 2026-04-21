import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRfqDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  coverLetter?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  customTerms?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  deadline?: string;
}
