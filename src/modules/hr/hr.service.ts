import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { department, position, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (tenantId != null) where.tenantId = tenantId;
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
  }

  async findOne(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const employee = await this.prisma.employee.findFirst({
      where,
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async create(createEmployeeDto: CreateEmployeeDto, tenantId?: string) {
    const data: any = { ...createEmployeeDto };
    if (tenantId != null) data.tenantId = tenantId;
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

