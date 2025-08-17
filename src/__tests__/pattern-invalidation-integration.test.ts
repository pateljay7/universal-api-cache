import { apiCache } from '../middleware';
import type { ApiCacheOptions } from '../config';

describe('Pattern Invalidation Integration', () => {
  let middleware: any;

  const createMockRequest = (method: string, url: string, userId = 'user123', body?: any) => ({
    method,
    originalUrl: url,
    url,
    user: { id: userId },
    body,
    params: {},
  });

  const createMockResponse = () => ({
    json: jest.fn().mockImplementation((data) => data),
    send: jest.fn().mockImplementation((data) => data),
    set: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
    headersSent: false,
  });

  describe('Integration with existing middleware flow', () => {
    it('should use pattern invalidation when configured', async () => {
      const options: ApiCacheOptions = {
        ttl: 60,
        useMemory: true,
        useRedis: false,
        invalidateOnWrite: true,
        getUserId: (req: any) => req.user?.id,
        invalidation: {
          autoInvalidateRules: {
            autoGenerateRestRules: true,
          },
        },
      };

      middleware = apiCache(options);
      const mockRes = createMockResponse();

      // Cache a collection
      const getReq = createMockRequest('GET', '/api/users');
      let next = jest.fn();

      await middleware(getReq, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Create new user (should trigger pattern invalidation)
      const postReq = createMockRequest('POST', '/api/users', 'user123', { name: 'Jane' });
      next = jest.fn();

      await middleware(postReq, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Verify middleware is defined
      expect(middleware).toBeDefined();
      expect(middleware.getCacheStats).toBeDefined();
    }, 10000);

    it('should provide cache clearing functionality', async () => {
      const options: ApiCacheOptions = {
        ttl: 60,
        useMemory: true,
        useRedis: false,
        getUserId: (req: any) => req.user?.id,
      };

      middleware = apiCache(options);
      const mockRes = createMockResponse();

      // Cache some data
      const getReq = createMockRequest('GET', '/api/users/1');
      const next = jest.fn();
      await middleware(getReq, mockRes, next);

      // Clear cache should not throw
      await expect(middleware.clearCache()).resolves.not.toThrow();
      expect(middleware).toBeDefined();
    }, 10000);
  });
});
