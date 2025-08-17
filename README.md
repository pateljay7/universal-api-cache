# universal-api-cache

Framework-agnostic caching middleware for Node.js with L1 (memory) and L2 (Redis) support.

Features:
- Cache GET by default, optional POST (idempotent) with `cachePostPredicate`
- **Pattern-based cache invalidation** with auto-generated REST rules
- Smart invalidation for collections, items, and nested resources
- Custom invalidation patterns with placeholder support (`{userId}`, `{postId}`, etc.)
- User scoping for multi-tenant applications
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
    getUserId: (req) => req.user?.id,
    // Pattern-based invalidation configuration
    invalidation: {
      autoInvalidateRules: {
        autoGenerateRestRules: true,
        customPatterns: {
          'users-profiles': ['GET:/api/users*', 'GET:/api/profiles*'],
          'posts-comments': ['GET:/api/posts/{postId}*', 'GET:/api/comments*']
        }
      },
      respectUserScope: true,
      enableInvalidationDebugging: true
    }
  }),
);

app.get('/users', (req, res) => res.json([{ id: 1, name: 'Alice' }]))
app.post('/search', (req, res) => res.json({ query: req.body.query, results: ['item1'] }))
```

## API

- `apiCache(options)` returns an Express-compatible middleware function with methods:
  - `clearCache(pattern?: string)` to invalidate keys by pattern
  - `getCacheStats()` to get `{ hits, misses, keys }`

### Configuration Options

```ts
interface ApiCacheOptions {
  // Basic caching
  ttl?: number;                    // Cache TTL in seconds (default: 60)
  methods?: string[];              // HTTP methods to cache (default: ['GET'])
  useMemory?: boolean;             // Enable memory store (default: true)
  useRedis?: boolean;              // Enable Redis store (default: false)
  redisUrl?: string;               // Redis connection URL
  
  // Cache behavior
  invalidateOnWrite?: boolean;     // Auto-invalidate on POST/PUT/PATCH/DELETE
  staleWhileRevalidate?: boolean;  // Serve stale data while refreshing
  maxPayloadSize?: number;         // Max response size to cache
  
  // Request filtering
  excludePaths?: string[];         // Paths to never cache
  skipCachePredicate?: (req) => boolean;     // Custom skip logic
  cachePostPredicate?: (req) => boolean;     // When to cache POST requests
  disableAuthCaching?: boolean;    // Skip caching for authenticated users
  
  // User identification
  getUserId?: (req) => string;     // Extract user ID for scoping
  getPerRouteTtl?: (req) => number; // Dynamic TTL per route
  
  // Pattern-based invalidation
  invalidation?: InvalidationOptions;
  
  // Manual invalidation
  getInvalidationPatterns?: (req) => string[]; // Custom invalidation logic
  
  // Logging
  logger?: {
    debug?: (message: string, ...args: any[]) => void;
    info?: (message: string, ...args: any[]) => void;
    warn?: (message: string, ...args: any[]) => void;
  };
}
```

### InvalidationOptions (Pattern-Based Cache Invalidation)

```ts
interface InvalidationOptions {
  // Enable automatic pattern-based invalidation
  enablePatternInvalidation?: boolean;  // Enable the entire invalidation system (default: true when invalidation config exists)
  
  // Built-in invalidation rules
  autoInvalidateRules?: {
    // Automatically create rules for common REST patterns
    autoGenerateRestRules?: boolean;    // Auto-create REST invalidation patterns (default: false)
    
    // Auto-invalidate parent resources when child resources change  
    autoInvalidateParents?: boolean;    // POST /api/users/123/posts → invalidates GET /api/users/123* (default: true)
    
    // Auto-invalidate collection when items change
    autoInvalidateCollections?: boolean; // POST /api/users → invalidates GET /api/users* (default: true)
    
    // Custom named invalidation patterns
    customPatterns?: {
      [ruleName: string]: string[];     // Named groups of patterns to invalidate together
    };
  };
  
  // Custom invalidation rules (advanced)
  invalidationRules?: InvalidationRule[];  // Array of custom invalidation rules
  
  // User scoping and security
  respectUserScope?: boolean;           // Only invalidate cache for the current user (default: true)
  
  // Performance and safety limits
  maxInvalidationDepth?: number;        // Prevent infinite recursion in rule chains (default: 3)
  invalidationTimeout?: number;         // Timeout for invalidation operations in ms (default: 5000)
  
  // Debugging and monitoring
  enableInvalidationDebugging?: boolean; // Enable detailed invalidation logging (default: false)
}

interface InvalidationRule {
  // Trigger conditions - when should this rule fire?
  methods: CacheMethod[];              // HTTP methods that trigger this rule ['POST', 'PUT', 'DELETE']
  pathPattern: string | RegExp;        // Path pattern that must match to trigger rule
  condition?: (req: any) => boolean;   // Optional additional condition function
  
  // Invalidation targets - what should be invalidated?
  invalidatePatterns: string[];        // Cache key patterns to invalidate when rule triggers
  invalidateMethods?: CacheMethod[];   // Which cached methods to invalidate (default: ['GET'])
  respectUserScope?: boolean;          // Whether to only invalidate for the same user (default: true)
  
  // Metadata for debugging and organization
  name?: string;                       // Rule name for debugging logs
  description?: string;                // Human-readable rule description
}
```

### Cache key format
`{method}:{normalized_url}:{sorted_query_params}:{hashed_request_body}:{userId_or_anon}`

- `normalized_url` excludes query string
- Query params sorted alphabetically
- Request body hashed with SHA-256 for non-GET
- `userId_or_anon` via `getUserId(req)`

### Invalidation Pattern Format

Patterns use the format: `{method}:{path_pattern}`

- **Method**: `GET`, `POST`, `PUT`, `DELETE`, or `*` for any method
- **Path Pattern**: URL path with optional wildcards and placeholders
  - `*` matches any characters
  - `{placeholder}` gets replaced with actual values from request
  - Patterns are case-sensitive

Examples:
```ts
'GET:/api/users*'           // All GET requests to /api/users and sub-paths
'*:/api/posts/123*'         // Any method to /api/posts/123 and sub-paths  
'GET:/api/users/{userId}*'  // GET requests with userId placeholder
'POST:/api*'                // All POST requests under /api
```

### Performance Considerations

- **Pattern Deduplication**: Identical patterns are processed only once per invalidation
- **User Scoping**: When enabled, only processes cache keys for the current user
- **Background Processing**: Invalidation happens asynchronously when possible
- **Efficient Matching**: Optimized wildcard and placeholder matching algorithms
- **Request Coalescing**: Prevents cache stampede during high concurrency

### Debugging

Enable detailed logging to troubleshoot invalidation:

```ts
invalidation: {
  enableInvalidationDebugging: true
}

// Logs will show:
// [PatternInvalidation] Starting pattern invalidation { requestId, method, path, userId }
// [PatternInvalidation] Processing rule { ruleName, patterns }
// [PatternInvalidation] Invalidating pattern { pattern, keysFound, keysInvalidated }
// [PatternInvalidation] Pattern invalidation completed { duration, keysProcessed }
```

## Testing

```
npm test
```

## Real-World Examples

### E-commerce Application

```ts
app.use(apiCache({
  ttl: 300,  // 5 minutes
  useMemory: true,
  useRedis: true,
  redisUrl: process.env.REDIS_URL,
  invalidateOnWrite: true,
  getUserId: (req) => req.user?.id,
  
  invalidation: {
    autoInvalidateRules: {
      autoGenerateRestRules: true,
      customPatterns: {
        // Product updates affect categories and search
        'product-updates': [
          'GET:/api/products*',
          'GET:/api/categories*',
          'GET:/api/search*'
        ],
        
        // Cart changes affect user's cart and recommendations
        'cart-updates': [
          'GET:/api/cart/{userId}*',
          'GET:/api/recommendations/{userId}*'
        ],
        
        // Order placement affects inventory and user data
        'order-placement': [
          'GET:/api/products*',        // Inventory changes
          'GET:/api/users/{userId}*',  // User order history
          'GET:/api/analytics*'        // Sales analytics
        ]
      }
    },
    respectUserScope: true,
    enableInvalidationDebugging: process.env.NODE_ENV === 'development'
  }
}));
```

### Social Media Platform

```ts
app.use(apiCache({
  ttl: 180,  // 3 minutes
  invalidateOnWrite: true,
  getUserId: (req) => req.user?.id,
  
  invalidation: {
    autoInvalidateRules: {
      autoGenerateRestRules: true,
      customPatterns: {
        // Post interactions affect feeds and notifications
        'post-interactions': [
          'GET:/api/posts/{postId}*',
          'GET:/api/feed*',
          'GET:/api/notifications*'
        ],
        
        // Follow/unfollow affects multiple user relationships
        'user-relationships': [
          'GET:/api/users/{userId}/followers*',
          'GET:/api/users/{userId}/following*',
          'GET:/api/feed/{userId}*'
        ],
        
        // Comment creation affects post and notification data
        'comment-activity': [
          'GET:/api/posts/{postId}*',
          'GET:/api/comments*',
          'GET:/api/notifications*'
        ]
      }
    },
    respectUserScope: true
  },
  
  // Cache search results but not real-time data
  cachePostPredicate: (req) => req.path.includes('/search'),
  excludePaths: ['/api/messages', '/api/notifications/realtime']
}));
```

### Multi-tenant SaaS Application

```ts
app.use(apiCache({
  ttl: 600,  // 10 minutes
  getUserId: (req) => `${req.tenant?.id}:${req.user?.id}`,
  
  invalidation: {
    autoInvalidateRules: {
      autoGenerateRestRules: true,
      customPatterns: {
        // Tenant settings affect all tenant data
        'tenant-settings': [
          'GET:/api/tenants/{tenantId}*',
          'GET:/api/dashboard*',
          'GET:/api/users*'
        ],
        
        // User role changes affect permissions and UI
        'user-permissions': [
          'GET:/api/users/{userId}*',
          'GET:/api/permissions*',
          'GET:/api/menu*'
        ]
      }
    },
    respectUserScope: true,  // Critical for multi-tenancy
    enableInvalidationDebugging: true
  },
  
  // Custom invalidation for admin actions
  getInvalidationPatterns: (req) => {
    if (req.user?.role === 'admin' && req.path.includes('/admin/')) {
      return [`GET:*:*:*:${req.tenant.id}:*`];  // Clear entire tenant cache
    }
    return [];
  }
}));
```

### Invalidation Configuration Examples

#### Basic Auto-Generated REST Rules
```ts
invalidation: {
  autoInvalidateRules: {
    autoGenerateRestRules: true        // Automatically handles common REST patterns
  }
}

// Auto-generated behavior:
// POST /api/users        → invalidates GET:/api/users*
// PUT /api/users/123     → invalidates GET:/api/users/123*, GET:/api/users*  
// DELETE /api/posts/456  → invalidates GET:/api/posts/456*, GET:/api/posts*
```

#### Custom Pattern Groups
```ts
invalidation: {
  autoInvalidateRules: {
    autoGenerateRestRules: true,
    customPatterns: {
      // E-commerce: Product changes affect multiple endpoints
      'product-updates': [
        'GET:/api/products*',          // Product listings
        'GET:/api/categories*',        // Category pages
        'GET:/api/search*',            // Search results
        'GET:/api/recommendations*'    // Recommendation engine
      ],
      
      // Social: User interactions affect feeds and notifications  
      'user-interactions': [
        'GET:/api/feed*',              // User feeds
        'GET:/api/notifications*',     // Notifications
        'GET:/api/users/{userId}*'     // User profiles (with placeholder)
      ],
      
      // Multi-tenant: Tenant settings affect all tenant data
      'tenant-updates': [
        'GET:/api/dashboard*',         // Dashboard data
        'GET:/api/settings*',          // Settings pages
        'GET:/api/users*',             // User lists
        'GET:/api/permissions*'        // Permission data
      ]
    }
  },
  respectUserScope: true,              // Only invalidate current user's cache
  enableInvalidationDebugging: true    // Log invalidation operations
}
```

#### Advanced Custom Rules
```ts
invalidation: {
  invalidationRules: [
    {
      name: 'admin-cache-clear',
      description: 'Admin actions clear entire cache',
      methods: ['POST', 'PUT', 'DELETE'],
      pathPattern: /^\/api\/admin\//,
      condition: (req) => req.user?.role === 'admin',
      invalidatePatterns: ['GET:*'],   // Clear everything
      respectUserScope: false          // Clear for all users
    },
    {
      name: 'order-fulfillment', 
      description: 'Order status changes affect inventory and user data',
      methods: ['PUT', 'PATCH'],
      pathPattern: '/api/orders/{orderId}/status',
      invalidatePatterns: [
        'GET:/api/products*',          // Inventory updates
        'GET:/api/users/{userId}*',    // User order history
        'GET:/api/analytics/sales*'    // Sales reports
      ],
      invalidateMethods: ['GET', 'POST'], // Also clear cached POST searches
      respectUserScope: true
    },
    {
      name: 'content-moderation',
      description: 'Content moderation affects multiple feeds',
      methods: ['PUT'],
      pathPattern: /^\/api\/(posts|comments)\/\d+\/moderate$/,
      invalidatePatterns: [
        'GET:/api/feed*',              // All feeds
        'GET:/api/trending*',          // Trending content
        'GET:/api/posts/{postId}*',    // Specific post
        'GET:/api/comments*'           // Comment threads
      ]
    }
  ],
  
  // Performance settings
  maxInvalidationDepth: 5,             // Allow deeper rule chains
  invalidationTimeout: 10000,          // 10 second timeout
  enableInvalidationDebugging: process.env.NODE_ENV === 'development'
}
```
