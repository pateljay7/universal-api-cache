export type CacheMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
}

export const defaultConfig: Required<
  Omit<
    ApiCacheOptions,
    'skipCachePredicate' | 'logger' | 'getUserId' | 'getPerRouteTtl' | 'cachePostPredicate' | 'getInvalidationPatterns'
  >
> &
  Pick<
    ApiCacheOptions,
    'skipCachePredicate' | 'logger' | 'getUserId' | 'getPerRouteTtl' | 'cachePostPredicate' | 'getInvalidationPatterns'
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
};
