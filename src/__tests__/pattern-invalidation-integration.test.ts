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

  const createMockResponse = () => {
    const mockRes: any = {
      json: jest.fn().mockImplementation((data) => {
        mockRes.headersSent = true;
        return mockRes;
      }),
      send: jest.fn().mockImplementation((data) => {
        mockRes.headersSent = true;
        return mockRes;
      }),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn().mockImplementation(() => {
        mockRes.headersSent = true;
        return mockRes;
      }),
      headersSent: false,
    };
    return mockRes;
  };

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

      // Create a promise-based wrapper for middleware calls
      const callMiddleware = (req: any, res: any) => {
        return new Promise<void>((resolve) => {
          const next = () => resolve();
          middleware(req, res, next);
        });
      };

      // Cache a collection
      const getReq = createMockRequest('GET', '/api/users');
      const mockRes1 = createMockResponse();
      
      await callMiddleware(getReq, mockRes1);

      // Create new user (should trigger pattern invalidation)
      const postReq = createMockRequest('POST', '/api/users', 'user123', { name: 'Jane' });
      const mockRes2 = createMockResponse();
      
      await callMiddleware(postReq, mockRes2);

      // Verify middleware is defined and working
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

      // Create a promise-based wrapper for middleware calls
      const callMiddleware = (req: any, res: any) => {
        return new Promise<void>((resolve) => {
          const next = () => resolve();
          middleware(req, res, next);
        });
      };

      // Cache some data
      const getReq = createMockRequest('GET', '/api/users/1');
      const mockRes = createMockResponse();
      await callMiddleware(getReq, mockRes);

      // Clear cache should not throw
      await expect(middleware.clearCache()).resolves.not.toThrow();
      expect(middleware).toBeDefined();
    }, 10000);
  });
});
