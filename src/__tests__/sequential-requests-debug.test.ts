import { apiCache } from '../middleware';

describe('Sequential Requests Cache Debug', () => {
  it('should cache and hit on sequential requests', async () => {
    const cache = apiCache({
      ttl: 300,
      useMemory: true,
      useRedis: false,
      cachePostPredicate: () => true,
      logger: {
        debug: (msg: string, ...args: any[]) => {
          console.log(`[DEBUG] ${msg}`, ...args);
        }
      }
    });

    const testReq = {
      method: 'POST',
      url: '/api/data',
      path: '/api/data',
      body: { query: 'test' }
    };

    console.log('=== FIRST REQUEST ===');
    console.log('Cache stats before first request:', (cache as any).getCacheStats());
    
    const mockRes1: any = {
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    const next1 = jest.fn(() => {
      mockRes1.json({ data: 'response1' });
    });

    await cache(testReq, mockRes1, next1);
    console.log('First request completed');
    console.log('Cache stats after first request:', (cache as any).getCacheStats());
    console.log('Handler called for first request:', next1.mock.calls.length > 0);

    console.log('\\n=== SECOND REQUEST (immediate) ===');
    
    const mockRes2: any = {
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    const next2 = jest.fn(() => {
      console.log('ERROR: Handler called for second request - should have hit cache!');
      mockRes2.json({ data: 'response2' });
    });

    await cache(testReq, mockRes2, next2);
    console.log('Second request completed');
    console.log('Cache stats after second request:', (cache as any).getCacheStats());
    console.log('Handler called for second request:', next2.mock.calls.length > 0);

    if (next2.mock.calls.length === 0) {
      console.log('SUCCESS: Second request hit cache!');
    } else {
      console.log('ERROR: Second request missed cache!');
    }

    console.log('\\n=== THIRD REQUEST (with delay) ===');
    
    // Add a small delay to ensure async operations complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const mockRes3: any = {
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    const next3 = jest.fn(() => {
      console.log('ERROR: Handler called for third request - should have hit cache!');
      mockRes3.json({ data: 'response3' });
    });

    await cache(testReq, mockRes3, next3);
    console.log('Third request completed');
    console.log('Cache stats after third request:', (cache as any).getCacheStats());
    console.log('Handler called for third request:', next3.mock.calls.length > 0);

    if (next3.mock.calls.length === 0) {
      console.log('SUCCESS: Third request hit cache!');
    } else {
      console.log('ERROR: Third request missed cache!');
    }
  });
});
