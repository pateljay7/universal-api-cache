export type CacheMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface InvalidationRule {
  // Trigger conditions
  methods: CacheMethod[]; // Which HTTP methods trigger this rule
  pathPattern: string | RegExp; // Path pattern that must match
  condition?: (req: any) => boolean; // Optional additional condition
  
  // Invalidation targets
  invalidatePatterns: string[]; // Cache key patterns to invalidate
  invalidateMethods?: CacheMethod[]; // Which cached methods to invalidate (default: ['GET'])
  respectUserScope?: boolean; // Whether to only invalidate for the same user (default: true)
  
  // Metadata
  name?: string; // Rule name for debugging
  description?: string; // Rule description
}

export interface InvalidationOptions {
  // Enable automatic pattern-based invalidation
  enablePatternInvalidation?: boolean;
  
  // Built-in invalidation rules
  autoInvalidateRules?: {
    // Automatically create rules for common REST patterns
    autoGenerateRestRules?: boolean;
    // Auto-invalidate parent resources when child resources change
    autoInvalidateParents?: boolean;
    // Auto-invalidate collection when items change
    autoInvalidateCollections?: boolean;
  };
  
  // Custom invalidation rules
  invalidationRules?: InvalidationRule[];
  
  // Advanced options
  maxInvalidationDepth?: number; // Prevent infinite recursion (default: 3)
  invalidationTimeout?: number; // Timeout for invalidation operations (ms, default: 5000)
  enableInvalidationDebugging?: boolean; // Log invalidation operations
}

export interface ApiCacheOptions {
  ttl?: number; // seconds
  methods?: CacheMethod[];
  redisUrl?: string;
  useMemory?: boolean; // L1
  useRedis?: boolean; // L2
  invalidateOnWrite?: boolean;
  staleWhileRevalidate?: boolean;
  excludePaths?: string[]; // path prefixes
  maxPayloadSize?: number; // bytes
  skipCachePredicate?: (req: any) => boolean;
  disableAuthCaching?: boolean; // if true, disable caching when req.user exists
  logger?: {
    debug?: (...args: any[]) => void;
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
  getUserId?: (req: any) => string | undefined;
  getPerRouteTtl?: (req: any) => number | undefined;
  // Whether a POST request is idempotent and cacheable
  cachePostPredicate?: (req: any) => boolean;
  // Provide extra invalidation patterns to run for write operations
  getInvalidationPatterns?: (req: any) => string[] | undefined;
  
  // Pattern-based invalidation
  invalidation?: InvalidationOptions;
}

export const defaultConfig: Required<
  Omit<
    ApiCacheOptions,
    'skipCachePredicate' | 'logger' | 'getUserId' | 'getPerRouteTtl' | 'cachePostPredicate' | 'getInvalidationPatterns' | 'invalidation'
  >
> &
  Pick<
    ApiCacheOptions,
    'skipCachePredicate' | 'logger' | 'getUserId' | 'getPerRouteTtl' | 'cachePostPredicate' | 'getInvalidationPatterns' | 'invalidation'
  > = {
  ttl: 60,
  methods: ['GET', 'POST'],
  redisUrl: 'redis://localhost:6379',
  useMemory: true,
  useRedis: false,
  invalidateOnWrite: true,
  staleWhileRevalidate: true,
  excludePaths: [],
  maxPayloadSize: 1024 * 1024, // 1MB
  skipCachePredicate: () => false,
  disableAuthCaching: false,
  logger: console,
  getUserId: (req: any) => req?.user?.id,
  getPerRouteTtl: () => undefined,
  cachePostPredicate: () => false,
  getInvalidationPatterns: () => undefined,
  invalidation: undefined,
};
