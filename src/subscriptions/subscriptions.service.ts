import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionsRepository: Repository<Subscription>,
  ) {}

  create(createSubscriptionDto: CreateSubscriptionDto): Promise<Subscription> {
    const subscription = this.subscriptionsRepository.create(createSubscriptionDto);
    return this.subscriptionsRepository.save(subscription);
  }

  findAll(): Promise<Subscription[]> {
    return this.subscriptionsRepository.find({
      relations: ['tenant', 'plan', 'subscriptionFeatures', 'subscriptionFeatures.feature'],
    });
  }

  findOne(id: string): Promise<Subscription> {
    return this.subscriptionsRepository.findOne({
      where: { id },
      relations: ['tenant', 'plan', 'plan.planFeatures', 'plan.planFeatures.feature', 'subscriptionFeatures', 'subscriptionFeatures.feature'],
    });
  }

  findByTenantId(tenantId: string): Promise<Subscription> {
    return this.subscriptionsRepository.findOne({
      where: { tenantId },
      relations: ['plan', 'plan.planFeatures', 'plan.planFeatures.feature', 'subscriptionFeatures', 'subscriptionFeatures.feature'],
    });
  }

  update(id: string, updateSubscriptionDto: UpdateSubscriptionDto): Promise<Subscription> {
    return this.subscriptionsRepository.save({
      id,
      ...updateSubscriptionDto,
    });
  }

  remove(id: string): Promise<void> {
    return this.subscriptionsRepository.delete(id).then(() => undefined);
  }

  async checkSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.findByTenantId(tenantId);
    if (!subscription) return false;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(subscription.endDate);
    endDate.setHours(0, 0, 0, 0);

    return (
      subscription.status === SubscriptionStatus.ACTIVE &&
      endDate >= today
    );
  }
}


