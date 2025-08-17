import { apiCache } from '../middleware';

describe('Stores Array Debug', () => {
  it('should check if stores are properly initialized', async () => {
    console.log('Creating cache with useMemory: true, useRedis: false');
    
    const cache = apiCache({
      ttl: 300,
      useMemory: true,
      useRedis: false,
      cachePostPredicate: () => true,
      logger: {
        debug: (msg: string, ...args: any[]) => {
          console.log(`[DEBUG] ${msg}`, ...args);
        },
        warn: (msg: string, ...args: any[]) => {
          console.log(`[WARN] ${msg}`, ...args);
        },
        error: (msg: string, ...args: any[]) => {
          console.log(`[ERROR] ${msg}`, ...args);
        }
      }
    });

    // Try to inspect the cache internals
    console.log('Cache function created');
    console.log('Cache function properties:', Object.keys(cache));
    
    // Get cache stats to see if stores are working
    try {
      const stats = (cache as any).getCacheStats();
      console.log('Cache stats:', stats);
    } catch (e) {
      console.log('Error getting cache stats:', e);
    }

    const testReq = {
      method: 'POST',
      url: '/test',
      path: '/test',
      body: { test: true }
    };

    const mockRes: any = {
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    const next = jest.fn(() => {
      console.log('Handler called');
      mockRes.json({ success: true });
    });

    console.log('Calling middleware...');
    await cache(testReq, mockRes, next);
    
    console.log('Middleware call completed');
    
    // Check stats after request
    try {
      const stats = (cache as any).getCacheStats();
      console.log('Cache stats after request:', stats);
    } catch (e) {
      console.log('Error getting cache stats after request:', e);
    }
  });
});
