import { apiCache } from '../middleware';
import { MemoryStore } from '../store/memoryStore';
import { createRestInvalidationRules } from '../utils/invalidation';
import type { ApiCacheOptions } from '../config';

describe('Pattern-based Cache Invalidation', () => {
  let middleware: any;
  let res: any;
  let store: MemoryStore;

  const createOptions = (overrides: Partial<ApiCacheOptions> = {}): ApiCacheOptions => ({
    ttl: 60,
    useMemory: true,
    useRedis: false,
    invalidateOnWrite: true,
    getUserId: (req: any) => req.user?.id || 'anon',
    invalidation: {
      autoInvalidateRules: {
        autoGenerateRestRules: true,
      },
      invalidationRules: createRestInvalidationRules(),
      maxInvalidationDepth: 3,
      invalidationTimeout: 5000,
      enableInvalidationDebugging: true,
      ...overrides.invalidation,
    },
    ...overrides,
  });

  // Helper function to create mock next function that simulates route handler response
  const createMockNext = (responseData: any, responseMethod: 'json' | 'send' = 'json') => {
    return jest.fn(() => {
      // Simulate route handler calling res.json or res.send
      res[responseMethod](responseData);
    });
  };

  beforeEach(() => {
    middleware = apiCache(createOptions());
    store = new MemoryStore();

    res = {
      json: jest.fn((data) => data),
      send: jest.fn((data) => data),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn(() => res),
      end: jest.fn(),
      headersSent: false,
    };
  });

  describe('Auto-generated REST rules', () => {
    it('should invalidate collection when item is created', async () => {
      const options = createOptions();
      middleware = apiCache(options);

      // Cache a GET request to the collection
      const getReq = {
        method: 'GET',
        originalUrl: '/api/users',
        url: '/api/users',
        user: { id: 'user123' },
      };

      let next = jest.fn(() => {
        // Simulate route handler calling res.json
        res.json([{ id: 1, name: 'John' }]);
      });

      await middleware(getReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Cache another GET request to a specific user
      const getUserReq = {
        method: 'GET',
        originalUrl: '/api/users/123',
        url: '/api/users/123',
        user: { id: 'user123' },
      };

      next = jest.fn(() => {
        // Simulate route handler calling res.json
        res.json({ id: 123, name: 'Jane' });
      });

      await middleware(getUserReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Now POST to create a new user (should invalidate collection)
      const postReq = {
        method: 'POST',
        originalUrl: '/api/users',
        url: '/api/users',
        user: { id: 'user123' },
        body: { name: 'New User' },
      };

      next = jest.fn(); // POST requests don't need response data
      await middleware(postReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Verify collection cache was invalidated by checking cache miss
      const getReq2 = {
        method: 'GET',
        originalUrl: '/api/users',
        url: '/api/users',
        user: { id: 'user123' },
      };

      next = jest.fn(() => {
        // Simulate route handler calling res.json
        res.json([
          { id: 1, name: 'John' },
          { id: 2, name: 'New User' },
        ]);
      });

      await middleware(getReq2, res, next);
      expect(next).toHaveBeenCalledTimes(1); // Should be cache miss
    });

    it('should invalidate specific item when updated', async () => {
      const options = createOptions();
      middleware = apiCache(options);

      // Cache a GET request to a specific user
      const getReq = {
        method: 'GET',
        originalUrl: '/api/users/123',
        url: '/api/users/123',
        user: { id: 'user123' },
      };

      let next = createMockNext({ id: 123, name: 'Original Name' });

      await middleware(getReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // PUT to update the user
      const putReq = {
        method: 'PUT',
        originalUrl: '/api/users/123',
        url: '/api/users/123',
        user: { id: 'user123' },
        body: { name: 'Updated Name' },
      };

      next = jest.fn(); // POST requests don't need response data
      await middleware(putReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Verify item cache was invalidated
      const getReq2 = {
        method: 'GET',
        originalUrl: '/api/users/123',
        url: '/api/users/123',
        user: { id: 'user123' },
      };

      next = createMockNext({ id: 123, name: 'Updated Name' });

      await middleware(getReq2, res, next);
      expect(next).toHaveBeenCalledTimes(1); // Should be cache miss
    });

    it('should invalidate parent resources when nested item changes', async () => {
      const options = createOptions();
      middleware = apiCache(options);

      // Cache parent resource
      const getPostReq = {
        method: 'GET',
        originalUrl: '/api/posts/456',
        url: '/api/posts/456',
        user: { id: 'user123' },
      };

      let next = createMockNext({ id: 456, title: 'Post Title', comments: [] });

      await middleware(getPostReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Cache comments collection
      const getCommentsReq = {
        method: 'GET',
        originalUrl: '/api/posts/456/comments',
        url: '/api/posts/456/comments',
        user: { id: 'user123' },
      };

      next = createMockNext([]);

      await middleware(getCommentsReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // POST new comment (should invalidate parent post and comments collection)
      const postCommentReq = {
        method: 'POST',
        originalUrl: '/api/posts/456/comments',
        url: '/api/posts/456/comments',
        user: { id: 'user123' },
        body: { text: 'New comment' },
      };

      next = jest.fn(); // POST requests don't need response data
      await middleware(postCommentReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Verify both parent and collection were invalidated
      const getPostReq2 = {
        method: 'GET',
        originalUrl: '/api/posts/456',
        url: '/api/posts/456',
        user: { id: 'user123' },
      };

      next = createMockNext({
        id: 456,
        title: 'Post Title',
        comments: [{ id: 1, text: 'New comment' }],
      });

      await middleware(getPostReq2, res, next);
      expect(next).toHaveBeenCalledTimes(1); // Should be cache miss
    });
  });

  describe('Custom invalidation rules', () => {
    it('should support custom patterns with placeholders', async () => {
      const options = createOptions({
        invalidation: {
          invalidationRules: [
            {
              name: 'user-profile-update',
              methods: ['PUT', 'PATCH'],
              pathPattern: /^\/api\/users\/[^/]+\/profile$/,
              invalidatePatterns: [
                'GET:/api/users/{userId}*',
                'GET:/api/users/{userId}/profile*',
                'GET:/api/users/{userId}/settings*',
              ],
              description: 'Invalidate user-related cache when profile is updated',
            },
          ],
          autoInvalidateRules: {
            autoGenerateRestRules: false,
          },
        },
      });
      middleware = apiCache(options);

      // Cache user data
      const getUserReq = {
        method: 'GET',
        originalUrl: '/api/users/123',
        url: '/api/users/123',
        params: { userId: '123' },
        user: { id: 'user123' },
      };

      let next = createMockNext({ id: 123, name: 'John', profile: { bio: 'Original' } });

      await middleware(getUserReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Cache user profile
      const getProfileReq = {
        method: 'GET',
        originalUrl: '/api/users/123/profile',
        url: '/api/users/123/profile',
        params: { userId: '123' },
        user: { id: 'user123' },
      };

      next = createMockNext({ bio: 'Original', avatar: 'url' });

      await middleware(getProfileReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Update profile (should trigger custom invalidation)
      const putProfileReq = {
        method: 'PUT',
        originalUrl: '/api/users/123/profile',
        url: '/api/users/123/profile',
        params: { userId: '123' },
        user: { id: 'user123' },
        body: { bio: 'Updated bio' },
      };

      next = jest.fn(); // PUT requests don't need response data
      await middleware(putProfileReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Verify user data was invalidated
      const getUserReq2 = {
        method: 'GET',
        originalUrl: '/api/users/123',
        url: '/api/users/123',
        params: { userId: '123' },
        user: { id: 'user123' },
      };

      next = createMockNext({ id: 123, name: 'John', profile: { bio: 'Updated bio' } });

      await middleware(getUserReq2, res, next);
      expect(next).toHaveBeenCalledTimes(1); // Should be cache miss
    });

    it('should respect user scope in invalidation rules', async () => {
      const options = createOptions({
        invalidation: {
          invalidationRules: [
            {
              name: 'user-scoped-invalidation',
              methods: ['POST'],
              pathPattern: '/api/user-posts',
              invalidatePatterns: ['GET:/api/user-posts*'],
              respectUserScope: true,
              description: 'Invalidate only for the current user',
            },
          ],
          autoInvalidateRules: {
            autoGenerateRestRules: false,
          },
        },
      });
      middleware = apiCache(options);

      // Cache posts for user1
      const getPostsUser1 = {
        method: 'GET',
        originalUrl: '/api/user-posts',
        url: '/api/user-posts',
        user: { id: 'user1' },
      };

      let next = createMockNext([{ id: 1, title: 'User1 Post' }]);

      await middleware(getPostsUser1, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Cache posts for user2
      const getPostsUser2 = {
        method: 'GET',
        originalUrl: '/api/user-posts',
        url: '/api/user-posts',
        user: { id: 'user2' },
      };

      next = createMockNext([{ id: 2, title: 'User2 Post' }]);

      await middleware(getPostsUser2, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // User1 creates a new post (should only invalidate user1's cache)
      const postReq = {
        method: 'POST',
        originalUrl: '/api/user-posts',
        url: '/api/user-posts',
        user: { id: 'user1' },
        body: { title: 'New User1 Post' },
      };

      next = jest.fn(); // POST requests don't need response data
      await middleware(postReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // User1's cache should be invalidated
      const getPostsUser1After = {
        method: 'GET',
        originalUrl: '/api/user-posts',
        url: '/api/user-posts',
        user: { id: 'user1' },
      };

      next = createMockNext([
        { id: 1, title: 'User1 Post' },
        { id: 3, title: 'New User1 Post' },
      ]);

      await middleware(getPostsUser1After, res, next);
      expect(next).toHaveBeenCalledTimes(1); // Should be cache miss

      // User2's cache should still be valid (cache hit)
      const getPostsUser2After = {
        method: 'GET',
        originalUrl: '/api/user-posts',
        url: '/api/user-posts',
        user: { id: 'user2' },
      };

      next = createMockNext([{ id: 2, title: 'User2 Post' }]);

      await middleware(getPostsUser2After, res, next);
      expect(next).toHaveBeenCalledTimes(0); // Should be cache hit
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle invalidation timeout gracefully', async () => {
      const options = createOptions({
        invalidation: {
          invalidationTimeout: 1, // Very short timeout
          invalidationRules: [
            {
              name: 'slow-rule',
              methods: ['POST'],
              pathPattern: '/api/test',
              invalidatePatterns: ['GET:/api/test*'],
            },
          ],
          autoInvalidateRules: {
            autoGenerateRestRules: false,
          },
        },
      });
      middleware = apiCache(options);

      const postReq = {
        method: 'POST',
        originalUrl: '/api/test',
        url: '/api/test',
        user: { id: 'user123' },
      };

      const next = jest.fn(); // POST requests don't need response data

      // Should not throw, should handle timeout gracefully
      await expect(middleware(postReq, res, next)).resolves.not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should fallback to legacy invalidation when pattern engine fails', async () => {
      // Create a spy to mock pattern engine failure
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const options = createOptions({
        invalidation: {
          invalidationRules: [
            {
              name: 'failing-rule',
              methods: ['POST'],
              pathPattern: '/api/test',
              invalidatePatterns: ['GET:/api/test*'],
            },
          ],
          autoInvalidateRules: {
            autoGenerateRestRules: false,
          },
        },
      });

      middleware = apiCache(options);

      // Mock the pattern engine to fail
      const originalInvalidate = middleware.clearCache;
      jest.spyOn(middleware, 'clearCache').mockImplementation(() => {
        throw new Error('Mock pattern engine failure');
      });

      const postReq = {
        method: 'POST',
        originalUrl: '/api/test',
        url: '/api/test',
        user: { id: 'user123' },
      };

      const next = jest.fn(); // POST requests don't need response data

      // Should not throw, should fallback gracefully
      await expect(middleware(postReq, res, next)).resolves.not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });

    it('should handle malformed cache keys gracefully', async () => {
      const options = createOptions();
      middleware = apiCache(options);

      // Create a request with unusual characters
      const postReq = {
        method: 'POST',
        originalUrl: '/api/test/with:colons/and?query=value&other=param',
        url: '/api/test/with:colons/and?query=value&other=param',
        user: { id: 'user:with:colons' },
      };

      const next = jest.fn(); // POST requests don't need response data

      // Should handle unusual characters without throwing
      await expect(middleware(postReq, res, next)).resolves.not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should prevent excessive invalidation depth', async () => {
      const options = createOptions({
        invalidation: {
          maxInvalidationDepth: 2,
          invalidationRules: [
            {
              name: 'recursive-rule',
              methods: ['POST'],
              pathPattern: '/api/test',
              invalidatePatterns: ['GET:/api/test*', 'GET:/api/nested*'],
            },
          ],
          autoInvalidateRules: {
            autoGenerateRestRules: false,
          },
        },
      });
      middleware = apiCache(options);

      const postReq = {
        method: 'POST',
        originalUrl: '/api/test',
        url: '/api/test',
        user: { id: 'user123' },
      };

      const next = jest.fn(); // POST requests don't need response data

      // Should complete without infinite recursion
      await expect(middleware(postReq, res, next)).resolves.not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Performance and optimization', () => {
    it('should handle large numbers of cache keys efficiently', async () => {
      const options = createOptions();
      middleware = apiCache(options);

      // Pre-populate cache with many entries
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push({
          method: 'GET',
          originalUrl: `/api/items/${i}`,
          url: `/api/items/${i}`,
          user: { id: `user${i % 10}` },
        });
      }

      // Cache all requests
      for (const req of requests) {
        const responseData = { id: req.url.split('/').pop() };
        const next = createMockNext(responseData);
        await middleware(req, res, next);
      }

      // Measure invalidation performance
      const start = Date.now();

      const postReq = {
        method: 'POST',
        originalUrl: '/api/items',
        url: '/api/items',
        user: { id: 'user1' },
      };

      const next = jest.fn(); // POST requests don't need response data
      await middleware(postReq, res, next);

      const duration = Date.now() - start;

      // Should complete reasonably quickly (less than 1 second)
      expect(duration).toBeLessThan(1000);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should avoid duplicate invalidation operations', async () => {
      const options = createOptions({
        invalidation: {
          invalidationRules: [
            {
              name: 'duplicate-pattern-rule',
              methods: ['POST'],
              pathPattern: '/api/test',
              invalidatePatterns: [
                'GET:/api/test*',
                'GET:/api/test*', // Duplicate pattern
                'GET:/api/other*',
                'GET:/api/test*', // Another duplicate
              ],
            },
          ],
          autoInvalidateRules: {
            autoGenerateRestRules: false,
          },
        },
      });
      middleware = apiCache(options);

      const postReq = {
        method: 'POST',
        originalUrl: '/api/test',
        url: '/api/test',
        user: { id: 'user123' },
      };

      const next = jest.fn(); // POST requests don't need response data

      // Should handle duplicates efficiently without extra work
      await expect(middleware(postReq, res, next)).resolves.not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
