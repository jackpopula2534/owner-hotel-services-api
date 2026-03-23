import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export interface CacheConfig {
  ttl?: number; // Time to live in seconds
  namespace?: string;
}

@Injectable()
export class CacheService implements OnModuleInit {
  private readonly logger = new Logger(CacheService.name);
  private isConnected = false;

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async onModuleInit() {
    try {
      // Test connection
      await this.set('__test__', 'test', { ttl: 1 });
      await this.del('__test__');
      this.isConnected = true;
      this.logger.log('Cache service initialized successfully');
    } catch (error) {
      this.logger.warn('Cache service not available, running without cache');
      this.isConnected = false;
    }
  }

  /**
   * Generate cache key with optional namespace
   */
  private generateKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, namespace?: string): Promise<T | null> {
    if (!this.isConnected) return null;

    try {
      const cacheKey = this.generateKey(key, namespace);
      const value = await this.cacheManager.get<T>(cacheKey);
      return value || null;
    } catch (error) {
      this.logger.error(`Cache get error: ${error.message}`);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, config?: CacheConfig): Promise<void> {
    if (!this.isConnected) return;

    try {
      const cacheKey = this.generateKey(key, config?.namespace);
      const ttl = config?.ttl || 300; // Default 5 minutes
      await this.cacheManager.set(cacheKey, value, ttl * 1000);
    } catch (error) {
      this.logger.error(`Cache set error: ${error.message}`);
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string, namespace?: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      const cacheKey = this.generateKey(key, namespace);
      await this.cacheManager.del(cacheKey);
    } catch (error) {
      this.logger.error(`Cache del error: ${error.message}`);
    }
  }

  /**
   * Get or set - fetch from cache or execute function and cache result
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    config?: CacheConfig,
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key, config?.namespace);
    if (cached !== null) {
      return cached;
    }

    // Fetch and cache
    const value = await fetchFn();
    await this.set(key, value, config);
    return value;
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.isConnected;
  }
}

// Cache key generators for common resources
export const CacheKeys = {
  // Room availability
  roomAvailability: (propertyId: string, date: string) =>
    `room:availability:${propertyId}:${date}`,

  // Menu items
  menuItems: (restaurantId: string) => `menu:${restaurantId}`,

  // Reports
  revenueReport: (tenantId: string, period: string) =>
    `report:revenue:${tenantId}:${period}`,
  occupancyReport: (tenantId: string, period: string) =>
    `report:occupancy:${tenantId}:${period}`,

  // Guest data
  guest: (guestId: string) => `guest:${guestId}`,
  guestList: (tenantId: string, page: number) => `guests:${tenantId}:${page}`,

  // Plans
  plans: () => 'plans:all',
  plan: (planId: string) => `plan:${planId}`,

  // Features
  features: () => 'features:all',
  tenantFeatures: (tenantId: string) => `features:tenant:${tenantId}`,
};

// Cache TTL configurations (in seconds)
export const CacheTTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 900, // 15 minutes
  HOUR: 3600, // 1 hour
  DAY: 86400, // 24 hours
};
