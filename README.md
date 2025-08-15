# Universal API Cache

Framework-agnostic caching middleware for Node.js with multi-tier caching support (L1 in-memory, L2 Redis). Works seamlessly with Express, NestJS, Koa, and Fastify.

## Features

- 🚀 **Multi-tier caching**: L1 (in-memory) + L2 (Redis)
- 🔄 **Stale-while-revalidate**: Serve stale data while refreshing in background
- 🎯 **Smart invalidation**: Auto-invalidate on write operations
- 📦 **Framework agnostic**: Works with Express, NestJS, Koa, Fastify
- 🔐 **Request coalescing**: Prevents cache stampede
- 📊 **Built-in metrics**: Cache hit/miss statistics
- ⚡ **TypeScript support**: Full type definitions included

## Installation

```bash
npm install universal-api-cache
```

## Quick Start

### Express

```javascript
import express from 'express';
import { apiCache } from 'universal-api-cache';

const app = express();

app.use(apiCache({
  ttl: 60, // seconds
  methods: ['GET', 'POST'],
  redisUrl: 'redis://localhost:6379',
  invalidateOnWrite: true,
  staleWhileRevalidate: true
}));

app.get('/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice' }]);
});
```

### NestJS

```typescript
import { NestFactory } from '@nestjs/core';
import { apiCache } from 'universal-api-cache';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Apply caching middleware globally
  app.use(apiCache({
    ttl: 300,
    methods: ['GET'],
    redisUrl: process.env.REDIS_URL,
    invalidateOnWrite: true,
    excludePaths: ['/health', '/metrics'],
    getUserId: (req) => req.user?.id
  }));
  
  await app.listen(3000);
}
bootstrap();
```

You can also use it as a NestJS middleware:

```typescript
// cache.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { apiCache } from 'universal-api-cache';

@Injectable()
export class CacheMiddleware implements NestMiddleware {
  private cacheMiddleware = apiCache({
    ttl: 300,
    methods: ['GET', 'POST'],
    redisUrl: process.env.REDIS_URL,
    invalidateOnWrite: true,
    cachePostPredicate: (req) => req.path.includes('/search')
  });

  use(req: Request, res: Response, next: NextFunction) {
    this.cacheMiddleware(req, res, next);
  }
}

// app.module.ts
import { Module, MiddlewareConsumer } from '@nestjs/common';
import { CacheMiddleware } from './cache.middleware';

@Module({})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CacheMiddleware)
      .forRoutes('*');
  }
}
```

## Configuration

```typescript
interface ApiCacheOptions {
  ttl?: number;                    // Default TTL in seconds (default: 60)
  methods?: string[];              // HTTP methods to cache (default: ['GET', 'POST'])
  useMemory?: boolean;             // Enable L1 memory cache (default: true)
  useRedis?: boolean;              // Enable L2 Redis cache (default: false)
  redisUrl?: string;               // Redis connection URL
  invalidateOnWrite?: boolean;     // Auto-invalidate on POST/PUT/PATCH/DELETE
  staleWhileRevalidate?: boolean;  // Serve stale while refreshing
  excludePaths?: string[];         // Paths to exclude from caching
  maxPayloadSize?: number;         // Max response size to cache (bytes)
  disableAuthCaching?: boolean;    // Disable caching for authenticated users
  
  // Advanced options
  getUserId?: (req: any) => string;
  getPerRouteTtl?: (req: any) => number;
  cachePostPredicate?: (req: any) => boolean;
  skipCachePredicate?: (req: any) => boolean;
  getInvalidationPatterns?: (req: any) => string[];
}
```

## Advanced Usage

### Conditional POST Caching

```typescript
app.use(apiCache({
  cachePostPredicate: (req) => {
    // Only cache search endpoints
    return req.path.includes('/search') || req.path.includes('/query');
  }
}));
```

### User-specific Caching

```typescript
app.use(apiCache({
  getUserId: (req) => req.user?.id,
  disableAuthCaching: false // Allow user-specific caching
}));
```

### Custom Invalidation

```typescript
app.use(apiCache({
  getInvalidationPatterns: (req) => {
    if (req.path === '/users') {
      return ['GET:/users*', 'POST:/search*']; // Invalidate related endpoints
    }
    return [];
  }
}));
```

### Manual Cache Control

```typescript
const cacheMiddleware = apiCache({ ttl: 300 });

// Clear specific pattern
await cacheMiddleware.clearCache('GET:/users*');

// Clear all cache
await cacheMiddleware.clearCache();

// Get statistics
const stats = cacheMiddleware.getCacheStats();
console.log(stats); // { hits: 120, misses: 30, keys: 50 }
```

## Framework Compatibility

| Framework | Status | Notes |
|-----------|---------|-------|
| Express   | ✅ Full | Native support |
| NestJS    | ✅ Full | Use as global middleware or module middleware |
| Koa       | ✅ Compatible | Works with koa-connect adapter |
| Fastify   | ✅ Compatible | Use with fastify-express plugin |

## Cache Key Format

```
{method}:{normalized_url}:{sorted_query_params}:{hashed_request_body}:{userId_or_anon}
```

Examples:
- `GET:/users:page=1&sort=name::anon`
- `POST:/search::sha256_hash:user123`

## Performance

- **L1 Cache**: ~0.1ms lookup time
- **L2 Cache**: ~1-5ms lookup time (Redis)
- **Memory Usage**: Configurable with `maxPayloadSize`
- **Network**: Reduces API calls by 60-90% in typical scenarios

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Lint
npm run lint
```

## License

MIT © Jay Patel

## Contributing

Pull requests welcome! Please read our contributing guidelines first.
