import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { department, position, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (department) where.department = department;
    if (position) where.position = position;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { employeeCode: { contains: search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.employee.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.employee.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      // ถ้าเกิด database error (table/column ไม่มี) ให้ส่ง empty data สำหรับผู้ใช้ใหม่
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return {
            data: [],
            total: 0,
            page,
            limit,
          };
        }
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

    const employee = await this.prisma.employee.findFirst({
      where,
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async create(createEmployeeDto: CreateEmployeeDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const data: any = { ...createEmployeeDto, tenantId };
    return this.prisma.employee.create({
      data,
    });
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.employee.update({
      where: { id },
      data: updateEmployeeDto,
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.employee.delete({
      where: { id },
    });
  }
}
