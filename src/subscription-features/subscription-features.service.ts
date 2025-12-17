import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionFeature } from './entities/subscription-feature.entity';
import { CreateSubscriptionFeatureDto } from './dto/create-subscription-feature.dto';

@Injectable()
export class SubscriptionFeaturesService {
  constructor(
    @InjectRepository(SubscriptionFeature)
    private subscriptionFeaturesRepository: Repository<SubscriptionFeature>,
  ) {}

  create(createSubscriptionFeatureDto: CreateSubscriptionFeatureDto): Promise<SubscriptionFeature> {
    const subscriptionFeature = this.subscriptionFeaturesRepository.create(createSubscriptionFeatureDto);
    return this.subscriptionFeaturesRepository.save(subscriptionFeature);
  }

  findAll(): Promise<SubscriptionFeature[]> {
    return this.subscriptionFeaturesRepository.find({
      relations: ['subscription', 'feature'],
    });
  }

  findBySubscriptionId(subscriptionId: string): Promise<SubscriptionFeature[]> {
    return this.subscriptionFeaturesRepository.find({
      where: { subscriptionId },
      relations: ['feature'],
    });
  }

  remove(id: string): Promise<void> {
    return this.subscriptionFeaturesRepository.delete(id).then(() => undefined);
  }
}


