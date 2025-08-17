# universal-api-cache

Framework-agnostic caching middleware for Node.js with L1 (memory) and L2 (Redis) support.

Features:
- Cache GET by default, optional POST (idempotent) with `cachePostPredicate`
- Stale-While-Revalidate
- Automatic invalidation on write (POST/PUT/PATCH/DELETE)
- Request coalescing
- Per-route TTL
- Skip via `skipCachePredicate`
- Multi-store (memory + Redis)

## Install

```
npm install universal-api-cache
```

## Usage (Express)

```ts
import express from 'express';
import { apiCache } from 'universal-api-cache';

const app = express();
app.use(express.json());

app.use(
  apiCache({
    ttl: 60,
    methods: ['GET', 'POST'],
    useMemory: true,
    useRedis: false,
    redisUrl: 'redis://localhost:6379',
    invalidateOnWrite: true,
    staleWhileRevalidate: true,
    excludePaths: ['/auth/login'],
    skipCachePredicate: (req) => !!req.headers['x-no-cache'],
    cachePostPredicate: (req) => req.path === '/search',
  }),
);

app.get('/users', (req, res) => res.json([{ id: 1, name: 'Alice' }]))
app.post('/search', (req, res) => res.json({ query: req.body.query, results: ['item1'] }))
```

## API

- `apiCache(options)` returns an Express-compatible middleware function with methods:
  - `clearCache(pattern?: string)` to invalidate keys by pattern
  - `getCacheStats()` to get `{ hits, misses, keys }`

### Cache key format
`{method}:{normalized_url}:{sorted_query_params}:{hashed_request_body}:{userId_or_anon}`

- `normalized_url` excludes query string
- Query params sorted alphabetically
- Request body hashed with SHA-256 for non-GET
- `userId_or_anon` via `getUserId(req)`

## Testing

```
npm test
```
