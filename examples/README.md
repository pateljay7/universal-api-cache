# Examples

This directory contains usage examples for different frameworks and use cases.

## Express Example

```javascript
const express = require('express');
const { apiCache } = require('universal-api-cache');

const app = express();
app.use(express.json());

// Apply caching middleware
app.use(apiCache({
  ttl: 60,
  methods: ['GET', 'POST'],
  useMemory: true,
  useRedis: false,
  staleWhileRevalidate: true,
  cachePostPredicate: (req) => req.path.includes('/search')
}));

app.get('/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
});

app.post('/search', (req, res) => {
  const { query } = req.body;
  res.json({ query, results: [`result for ${query}`] });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## GraphQL Example

See `graphql-example.js` for a complete GraphQL server setup with caching.

Key features for GraphQL:
- **Query Caching**: Automatically caches GraphQL queries based on operation name, variables, and user
- **Mutation Invalidation**: Mutations automatically invalidate related cached queries
- **Custom Cache Keys**: Generate cache keys based on GraphQL operation semantics
- **Operation-specific TTL**: Different cache durations for different operations
- **Introspection Caching**: Option to cache introspection queries

```javascript
const cache = apiCache({
  // GraphQL-specific options
  cacheIntrospection: true,
  graphQLKeyGenerator: (req) => {
    const { query, variables, operationName } = req.body;
    const userId = req.user?.id || 'anonymous';
    const opName = operationName || extractOperationName(query);
    return `graphql:${opName}:${JSON.stringify(variables)}:${userId}`;
  },
  getInvalidationPatterns: (req) => {
    // Return patterns to invalidate when mutations occur
    if (req.body.query.includes('createUser')) {
      return ['graphql:users:*', 'graphql:user:*'];
    }
    return [];
  }
});

app.use('/graphql', cache);
```

## NestJS Example

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { apiCache } from 'universal-api-cache';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Global caching middleware
  app.use(apiCache({
    ttl: 300,
    methods: ['GET'],
    useMemory: true,
    useRedis: true,
    redisUrl: process.env.REDIS_URL,
    excludePaths: ['/health', '/metrics'],
    getUserId: (req) => req.user?.id
  }));
  
  await app.listen(3000);
}
bootstrap();
```

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
    useMemory: true,
    useRedis: false,
    cachePostPredicate: (req) => req.path.includes('/search'),
    skipCachePredicate: (req) => !!req.headers['x-no-cache']
  });

  use(req: Request, res: Response, next: NextFunction) {
    this.cacheMiddleware(req, res, next);
  }
}
```

```typescript
// app.module.ts
import { Module, MiddlewareConsumer } from '@nestjs/common';
import { CacheMiddleware } from './cache.middleware';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CacheMiddleware)
      .forRoutes('users', 'search');
  }
}
```
