import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
  ) {}

  create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    const tenant = this.tenantsRepository.create(createTenantDto);
    return this.tenantsRepository.save(tenant);
  }

  findAll(): Promise<Tenant[]> {
    return this.tenantsRepository.find({
      relations: ['subscription', 'subscription.plan'],
    });
  }

  findOne(id: string): Promise<Tenant> {
    return this.tenantsRepository.findOne({
      where: { id },
      relations: ['subscription', 'subscription.plan', 'subscription.subscriptionFeatures', 'subscription.subscriptionFeatures.feature'],
    });
  }

  update(id: string, updateTenantDto: UpdateTenantDto): Promise<Tenant> {
    return this.tenantsRepository.save({
      id,
      ...updateTenantDto,
    });
  }

  remove(id: string): Promise<void> {
    return this.tenantsRepository.delete(id).then(() => undefined);
  }
}


