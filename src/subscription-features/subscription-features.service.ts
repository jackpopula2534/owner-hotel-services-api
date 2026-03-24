import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionFeatureDto } from './dto/create-subscription-feature.dto';

@Injectable()
export class SubscriptionFeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSubscriptionFeatureDto: CreateSubscriptionFeatureDto) {
    const data: any = {
      subscription_id: createSubscriptionFeatureDto.subscriptionId,
      feature_id: createSubscriptionFeatureDto.featureId,
      price: createSubscriptionFeatureDto.price,
    };

    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.subscription_features.create({
      data,
      include: { subscriptions: true, features: true },
    });
  }

  findAll() {
    return this.prisma.subscription_features.findMany({
      include: { subscriptions: true, features: true },
    });
  }

  findBySubscriptionId(subscriptionId: string) {
    return this.prisma.subscription_features.findMany({
      where: { subscription_id: subscriptionId },
      include: { features: true },
    });
  }

  remove(id: string) {
    return this.prisma.subscription_features.delete({
      where: { id },
    });
  }
}


