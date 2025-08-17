import type { CacheMethod, InvalidationRule, InvalidationOptions } from '../config';
import type { CacheStore } from '../middleware';

/**
 * Interface for parsed cache keys
 */
export interface ParsedCacheKey {
  method: string;
  path: string;
  query: string;
  bodyHash: string;
  userId: string;
  original: string;
}

/**
 * Pattern matching result
 */
export interface PatternMatch {
  pattern: string;
  keys: string[];
  rule?: InvalidationRule;
}

/**
 * Invalidation context for tracking operations
 */
export interface InvalidationContext {
  requestId: string;
  depth: number;
  processed: Set<string>;
  startTime: number;
  logger?: any;
}

/**
 * Pattern-based cache invalidation engine
 */
export class PatternInvalidationEngine {
  private readonly maxDepth: number;
  private readonly timeout: number;
  private readonly enableDebugging: boolean;
  private readonly logger?: any;

  constructor(options: InvalidationOptions, logger?: any) {
    this.maxDepth = options.maxInvalidationDepth ?? 3;
    this.timeout = options.invalidationTimeout ?? 5000;
    this.enableDebugging = options.enableInvalidationDebugging ?? false;
    this.logger = logger;
  }

  /**
   * Safely extract error message from unknown error type
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }

  /**
   * Main invalidation method
   */
  async invalidate(
    req: any,
    stores: CacheStore[],
    options: InvalidationOptions,
    getUserId: (req: any) => string | undefined
  ): Promise<void> {
    const context: InvalidationContext = {
      requestId: this.generateRequestId(),
      depth: 0,
      processed: new Set(),
      startTime: Date.now(),
      logger: this.logger
    };

    this.log(context, 'info', 'Starting pattern invalidation', {
      method: req.method,
      path: req.originalUrl || req.url,
      userId: getUserId(req)
    });

    try {
      await Promise.race([
        this.performInvalidation(req, stores, options, getUserId, context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Invalidation timeout')), this.timeout)
        )
      ]);

      this.log(context, 'info', 'Pattern invalidation completed', {
        duration: Date.now() - context.startTime,
        keysProcessed: context.processed.size
      });
    } catch (error) {
      this.log(context, 'error', 'Pattern invalidation failed', { error: this.getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Perform the actual invalidation
   */
  private async performInvalidation(
    req: any,
    stores: CacheStore[],
    options: InvalidationOptions,
    getUserId: (req: any) => string | undefined,
    context: InvalidationContext
  ): Promise<void> {
    if (context.depth >= this.maxDepth) {
      this.log(context, 'warn', 'Max invalidation depth reached', { depth: context.depth });
      return;
    }

    // Get applicable rules
    const rules = this.getApplicableRules(req, options);
    
    if (rules.length === 0) {
      this.log(context, 'debug', 'No applicable invalidation rules found');
      return;
    }

    // Process each rule
    for (const rule of rules) {
      await this.processRule(req, rule, stores, getUserId, context);
    }
  }

  /**
   * Get rules that apply to the current request
   */
  private getApplicableRules(req: any, options: InvalidationOptions): InvalidationRule[] {
    const rules: InvalidationRule[] = [];

    // Add auto-generated REST rules
    if (options.autoInvalidateRules?.autoGenerateRestRules) {
      rules.push(...this.generateRestRules(req));
    }

    // Add custom rules
    if (options.invalidationRules) {
      rules.push(...options.invalidationRules.filter(rule => this.ruleMatches(req, rule)));
    }

    return rules;
  }

  /**
   * Check if a rule matches the current request
   */
  private ruleMatches(req: any, rule: InvalidationRule): boolean {
    // Check HTTP method
    if (!rule.methods.includes(req.method as CacheMethod)) {
      return false;
    }

    // Check path pattern
    const path = req.originalUrl || req.url || '';
    if (rule.pathPattern instanceof RegExp) {
      if (!rule.pathPattern.test(path)) {
        return false;
      }
    } else {
      if (!this.matchPathPattern(path, rule.pathPattern)) {
        return false;
      }
    }

    // Check custom condition
    if (rule.condition && !rule.condition(req)) {
      return false;
    }

    return true;
  }

  /**
   * Process a single invalidation rule
   */
  private async processRule(
    req: any,
    rule: InvalidationRule,
    stores: CacheStore[],
    getUserId: (req: any) => string | undefined,
    context: InvalidationContext
  ): Promise<void> {
    this.log(context, 'debug', 'Processing invalidation rule', {
      ruleName: rule.name || 'unnamed',
      patterns: rule.invalidatePatterns
    });

    const userId = getUserId(req);
    const targetMethods = rule.invalidateMethods || ['GET'];

    for (const pattern of rule.invalidatePatterns) {
      const expandedPatterns = this.expandPattern(pattern, req, userId, rule.respectUserScope !== false);
      
      for (const expandedPattern of expandedPatterns) {
        if (context.processed.has(expandedPattern)) {
          this.log(context, 'debug', 'Pattern already processed, skipping', { pattern: expandedPattern });
          continue;
        }

        context.processed.add(expandedPattern);
        await this.invalidateByPattern(expandedPattern, targetMethods, stores, context, rule.respectUserScope, userId);
      }
    }
  }

  /**
   * Expand a pattern with request-specific values
   */
  private expandPattern(
    pattern: string,
    req: any,
    userId: string | undefined,
    respectUserScope: boolean
  ): string[] {
    let expanded = pattern;

    // Extract path parameters first
    const pathParams = this.extractPathParameters(req);
    
    // Replace path parameters first (these take precedence)
    for (const [key, value] of Object.entries(pathParams)) {
      if (value !== undefined && value !== null) {
        expanded = expanded.replace(new RegExp(`\\{${key}\\}`, 'g'), value as string);
      }
    }

    // Replace remaining placeholders with authenticated user context
    expanded = expanded.replace(/\{userId\}/g, userId || 'anon');
    expanded = expanded.replace(/\{path\}/g, this.normalizePath(req.originalUrl || req.url || ''));

    // Handle user scope
    if (respectUserScope && userId) {
      // Only invalidate for the specific user
      return [expanded];
    } else {
      // Invalidate for all users (replace userId with wildcard)
      const patterns = [expanded];
      if (expanded.includes(':anon')) {
        patterns.push(expanded.replace(':anon', ':*'));
      }
      return patterns;
    }
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  private async invalidateByPattern(
    pattern: string,
    targetMethods: CacheMethod[],
    stores: CacheStore[],
    context: InvalidationContext,
    respectUserScope?: boolean,
    currentUserId?: string
  ): Promise<void> {
    this.log(context, 'debug', 'Invalidating by pattern', { pattern, targetMethods });

    let totalInvalidated = 0;

    for (const store of stores) {
      try {
        const keys = await store.keys();
        const matchingKeys = keys.filter(key => {
          const parsed = this.parseCacheKey(key);
          if (!parsed || !targetMethods.includes(parsed.method as CacheMethod)) {
            return false;
          }
          
          // Check if pattern matches
          if (!this.keyMatchesPattern(key, pattern)) {
            return false;
          }
          
          // Apply user scoping if specified
          if (respectUserScope && currentUserId && parsed.userId !== currentUserId) {
            return false;
          }
          
          return true;
        });

        // Invalidate matching keys
        await Promise.all(matchingKeys.map(key => store.del(key)));
        totalInvalidated += matchingKeys.length;

        this.log(context, 'debug', 'Store invalidation complete', {
          storeType: store.constructor.name,
          keysFound: keys.length,
          keysInvalidated: matchingKeys.length
        });
      } catch (error) {
        this.log(context, 'error', 'Store invalidation failed', {
          storeType: store.constructor.name,
          error: this.getErrorMessage(error)
        });
      }
    }

    this.log(context, 'info', 'Pattern invalidation complete', {
      pattern,
      totalInvalidated
    });
  }

  /**
   * Check if a cache key matches a pattern
   */
  private keyMatchesPattern(key: string, pattern: string): boolean {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')                    // * matches any characters
      .replace(/\{[^}]+\}/g, '[^:]*')         // {param} matches non-colon characters
      .replace(/:/g, ':')                      // Literal colons
      .replace(/\?/g, '\\?')                   // Escape question marks
      .replace(/\+/g, '\\+');                  // Escape plus signs

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(key);
  }

  /**
   * Parse a cache key into components
   */
  private parseCacheKey(key: string): ParsedCacheKey | null {
    const parts = key.split(':');
    if (parts.length !== 5) {
      return null;
    }

    return {
      method: parts[0],
      path: parts[1],
      query: parts[2],
      bodyHash: parts[3],
      userId: parts[4],
      original: key
    };
  }

  /**
   * Generate automatic REST invalidation rules
   */
  private generateRestRules(req: any): InvalidationRule[] {
    const rules: InvalidationRule[] = [];
    const path = req.originalUrl || req.url || '';
    const method = req.method as CacheMethod;

    // Collection operations
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      // Invalidate collection listing when items are modified
      const collectionPath = this.getCollectionPath(path);
      if (collectionPath) {
        rules.push({
          methods: [method],
          pathPattern: path,
          invalidatePatterns: [
            `GET:${collectionPath}*`,     // All collection endpoints
            `GET:${collectionPath}:*:*:*`, // Exact collection cache keys
          ],
          name: `auto-collection-${method.toLowerCase()}`,
          description: `Auto-invalidate collection ${collectionPath} on ${method}`,
        });
      }

      // Invalidate specific item when modified
      if (['PUT', 'PATCH', 'DELETE'].includes(method)) {
        rules.push({
          methods: [method],
          pathPattern: path,
          invalidatePatterns: [
            `GET:${path}*`,      // All variations of this specific item
          ],
          name: `auto-item-${method.toLowerCase()}`,
          description: `Auto-invalidate item ${path} on ${method}`,
        });
      }

      // Invalidate parent resources
      const parentPaths = this.getParentPaths(path);
      if (parentPaths.length > 0) {
        rules.push({
          methods: [method],
          pathPattern: path,
          invalidatePatterns: parentPaths.map(p => `GET:${p}*`),
          name: `auto-parent-${method.toLowerCase()}`,
          description: `Auto-invalidate parent resources on ${method}`,
        });
      }
    }

    return rules;
  }

  /**
   * Extract collection path from item path
   */
  private getCollectionPath(path: string): string | null {
    // Remove query parameters
    const cleanPath = path.split('?')[0];
    
    // Common patterns:
    // /api/users/123 -> /api/users
    // /api/posts/456/comments/789 -> /api/posts/456/comments
    
    const pathParts = cleanPath.split('/').filter(Boolean);
    
    // If last part looks like an ID, remove it
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      if (this.looksLikeId(lastPart)) {
        pathParts.pop();
        return '/' + pathParts.join('/');
      }
    }

    return null;
  }

  /**
   * Get parent resource paths
   */
  private getParentPaths(path: string): string[] {
    const cleanPath = path.split('?')[0];
    const pathParts = cleanPath.split('/').filter(Boolean);
    const parents: string[] = [];

    // Generate all parent paths
    // /api/users/123/posts/456 -> ['/api/users/123', '/api/users', '/api']
    for (let i = pathParts.length - 1; i > 0; i--) {
      if (this.looksLikeId(pathParts[i])) {
        continue; // Skip ID parts
      }
      const parentPath = '/' + pathParts.slice(0, i).join('/');
      parents.push(parentPath);
    }

    return parents;
  }

  /**
   * Check if a string looks like an ID
   */
  private looksLikeId(str: string): boolean {
    // Numbers, UUIDs, or short alphanumeric strings
    return /^(\d+|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|[a-zA-Z0-9]{6,})$/.test(str);
  }

  /**
   * Match path pattern with wildcards
   */
  private matchPathPattern(path: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\{[^}]+\}/g, '[^/]+')
      .replace(/\?/g, '\\?');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Normalize path for consistent matching
   */
  private normalizePath(path: string): string {
    return path.split('?')[0]; // Remove query parameters
  }

  /**
   * Extract path parameters from request
   */
  private extractPathParameters(req: any): Record<string, any> {
    // Try to get from various common parameter sources
    return {
      ...req.params,
      ...req.query,
      id: req.params?.id || req.query?.id,
      userId: req.params?.userId || req.query?.userId,
    };
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Logging helper
   */
  private log(context: InvalidationContext, level: string, message: string, data?: any): void {
    if (!this.enableDebugging && level === 'debug') {
      return;
    }

    const logData = {
      requestId: context.requestId,
      depth: context.depth,
      ...data
    };

    if (this.logger && this.logger[level]) {
      this.logger[level](`[PatternInvalidation] ${message}`, logData);
    }
  }
}

/**
 * Helper function to create common REST invalidation rules
 */
export function createRestInvalidationRules(): InvalidationRule[] {
  return [
    // User management
    {
      name: 'users-collection',
      methods: ['POST'],
      pathPattern: /^\/api\/users\/?$/,
      invalidatePatterns: ['GET:/api/users*'],
      description: 'Invalidate user listings when new user is created'
    },
    {
      name: 'users-item',
      methods: ['PUT', 'PATCH', 'DELETE'],
      pathPattern: /^\/api\/users\/[^/]+\/?$/,
      invalidatePatterns: ['GET:/api/users*', 'GET:{path}*'],
      description: 'Invalidate user data when user is modified'
    },

    // Posts with user relationship
    {
      name: 'posts-collection',
      methods: ['POST'],
      pathPattern: /^\/api\/posts\/?$/,
      invalidatePatterns: ['GET:/api/posts*', 'GET:/api/users/*/posts*'],
      description: 'Invalidate post listings when new post is created'
    },
    {
      name: 'posts-item',
      methods: ['PUT', 'PATCH', 'DELETE'],
      pathPattern: /^\/api\/posts\/[^/]+\/?$/,
      invalidatePatterns: ['GET:/api/posts*', 'GET:{path}*'],
      description: 'Invalidate post data when post is modified'
    },

    // Comments with nested relationships
    {
      name: 'comments-nested',
      methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
      pathPattern: /^\/api\/posts\/[^/]+\/comments/,
      invalidatePatterns: [
        'GET:/api/posts/*/comments*',  // All post comments
        'GET:/api/posts/{postId}*',    // Parent post
        'GET:/api/comments*'           // Global comments
      ],
      description: 'Invalidate comment data and parent post when comments change'
    }
  ];
}
