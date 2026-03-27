import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

@Injectable()
export class AdminsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createAdminDto: CreateAdminDto) {
    return this.prisma.admin.create({
      data: createAdminDto,
    });
  }

  findAll() {
    return this.prisma.admin.findMany();
  }

  findOne(id: string) {
    return this.prisma.admin.findUnique({
      where: { id },
    });
  }

  findByEmail(email: string) {
    return this.prisma.admin.findUnique({
      where: { email },
    });
  }

  update(id: string, updateAdminDto: UpdateAdminDto) {
    return this.prisma.admin.update({
      where: { id },
      data: updateAdminDto,
    });
  }

  remove(id: string) {
    return this.prisma.admin.delete({
      where: { id },
    });
  }
}
