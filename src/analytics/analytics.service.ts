import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnalyticsEventDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async trackEvent(userId: string, tenantId: string, data: CreateAnalyticsEventDto) {
    return this.prisma.analyticsEvent.create({
      data: {
        userId,
        tenantId,
        eventName: data.eventName,
        metadata: data.metadata || {},
      },
    });
  }

  async getSummary(tenantId: string) {
    // In a real application, this would calculate actual data
    // For now, we return mock data as requested for Phase 4 support
    return {
      timeSaved: 120, // hours
      bookingsGrowth: 15, // percent
      occupancyRate: 78, // percent
      activeUsers: 5,
      popularChannels: [
        { name: 'Direct', value: 45 },
        { name: 'Booking.com', value: 30 },
        { name: 'Agoda', value: 25 },
      ],
    };
  }

  async getFeatureFlag(name: string, tenantId?: string) {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { name },
    });

    if (!flag || !flag.isActive) {
      return { isActive: false };
    }

    // Basic rule checking (e.g., specific tenantIds)
    if (flag.rules && typeof flag.rules === 'object') {
      const rules = flag.rules as any;
      if (rules.tenantIds && Array.isArray(rules.tenantIds)) {
        if (!tenantId || !rules.tenantIds.includes(tenantId)) {
          return { isActive: false };
        }
      }
    }

    return { isActive: true };
  }
}
