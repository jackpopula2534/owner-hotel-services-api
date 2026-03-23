import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createTenantDto: CreateTenantDto) {
    return this.prisma.tenants.create({
      data: createTenantDto as any,
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
  }

  findAll() {
    return this.prisma.tenants.findMany({
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.tenants.findUnique({
      where: { id },
      include: {
        subscriptions: {
          include: {
            plans_subscriptions_plan_idToplans: true,
            subscription_features: { include: { features: true } }
          }
        }
      },
    });
  }

  update(id: string, updateTenantDto: UpdateTenantDto) {
    return this.prisma.tenants.update({
      where: { id },
      data: updateTenantDto,
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
  }

  remove(id: string) {
    return this.prisma.tenants.delete({
      where: { id },
    });
  }
}


