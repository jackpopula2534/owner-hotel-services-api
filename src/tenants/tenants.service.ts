import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createTenantDto: CreateTenantDto & { trialEndsAt?: Date }) {
    const data: any = {
      name: createTenantDto.name,
      status: createTenantDto.status,
      room_count: createTenantDto.roomCount,
      name_en: createTenantDto.nameEn,
      property_type: createTenantDto.propertyType,
      location: createTenantDto.location,
      website: createTenantDto.website,
      description: createTenantDto.description,
      customer_name: createTenantDto.customerName,
      tax_id: createTenantDto.taxId,
      email: createTenantDto.email,
      phone: createTenantDto.phone,
      address: createTenantDto.address,
      district: createTenantDto.district,
      province: createTenantDto.province,
      postal_code: createTenantDto.postalCode,
      trial_ends_at: createTenantDto.trialEndsAt,
    };
    
    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.tenants.create({
      data,
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


