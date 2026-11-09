import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * ตัวเลือกของการนำพนักงาน HR ขึ้นทะเบียนพนักงานปฏิบัติการแบบยกชุด
 *
 * ไม่ส่งอะไรมาเลย = นำเข้าเฉพาะแผนกที่มีหน้างานในโรงแรม (HK, ENG) และเฉพาะคน
 * ที่ยังทำงานอยู่ ซึ่งเป็นพฤติกรรมที่ปลอดภัยสำหรับปุ่ม "นำเข้าทั้งหมด"
 */
export class BulkCreateStaffDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'เจาะจงพนักงานรายคน (Employee.id) — ถ้าส่งมา จะไม่สนใจตัวกรองแผนก',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'กรองตามแผนก HR (HrDepartment.id)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({
    description: 'true = ไม่กรองแผนก นำเข้าพนักงานที่ยังทำงานอยู่ทั้งหมด',
  })
  @IsOptional()
  @IsBoolean()
  allDepartments?: boolean;

  @ApiPropertyOptional({
    enum: ['housekeeper', 'technician'],
    description: 'บังคับตำแหน่งเดียวกันทุกคน — ไม่ส่ง = เดาจากแผนกรายคน',
  })
  @IsOptional()
  @IsIn(['housekeeper', 'technician'])
  role?: 'housekeeper' | 'technician';

  @ApiPropertyOptional({
    description: 'true = รวมพนักงานที่พ้นสภาพแล้วด้วย (ปกติไม่ควรใช้)',
  })
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}
