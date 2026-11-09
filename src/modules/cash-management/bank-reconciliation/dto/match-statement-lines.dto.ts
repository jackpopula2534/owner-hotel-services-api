import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';

export class StatementMatchPairDto {
  @ApiProperty()
  @IsUUID()
  statementLineId: string;

  @ApiProperty()
  @IsUUID()
  journalLineId: string;
}

export class MatchStatementLinesDto {
  @ApiProperty({ type: [StatementMatchPairDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StatementMatchPairDto)
  pairs: StatementMatchPairDto[];
}
