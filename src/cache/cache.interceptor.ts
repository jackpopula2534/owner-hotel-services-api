import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { CacheService } from './cache.service';

export const CACHE_KEY = 'cache_key';
export const CACHE_TTL = 'cache_ttl';
export const NO_CACHE = 'no_cache';

// Decorators for cache configuration
export const CacheKey = (key: string) => SetMetadata(CACHE_KEY, key);
export const CacheTTL = (ttl: number) => SetMetadata(CACHE_TTL, ttl);
export const NoCache = () => SetMetadata(NO_CACHE, true);

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cacheService: CacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    // Check if caching is disabled for this route
    const noCache = this.reflector.get<boolean>(NO_CACHE, context.getHandler());
    if (noCache) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();

    // Only cache GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    // Generate cache key
    const customKey = this.reflector.get<string>(CACHE_KEY, context.getHandler());
    const tenantId = request.user?.tenantId || 'public';
    const cacheKey = customKey
      ? `${tenantId}:${customKey}`
      : `${tenantId}:${request.url}`;

    // Check cache
    const cachedResponse = await this.cacheService.get(cacheKey);
    if (cachedResponse) {
      return of(cachedResponse);
    }

    // Get TTL from decorator or use default
    const ttl = this.reflector.get<number>(CACHE_TTL, context.getHandler()) || 300;

    // Execute handler and cache response
    return next.handle().pipe(
      tap(async (response) => {
        await this.cacheService.set(cacheKey, response, { ttl });
      }),
    );
  }
}
