import { apiCache } from '../middleware';
import { MemoryStore } from '../store/memoryStore';

describe('Cache Store Operations Debug', () => {
  it('should trace cache store operations step by step', async () => {
    // Create a custom memory store with logging
    const memoryStore = new MemoryStore();
    const originalGet = memoryStore.get.bind(memoryStore);
    const originalSet = memoryStore.set.bind(memoryStore);
    
    let getCalls = 0;
    let setCalls = 0;
    const getKeys: string[] = [];
    const setKeys: string[] = [];
    
    memoryStore.get = async function<T>(key: string) {
      getCalls++;
      getKeys.push(key);
      console.log(`[STORE GET #${getCalls}] Key: ${key}`);
      const result = await originalGet<T>(key);
      console.log(`[STORE GET #${getCalls}] Result:`, result ? 'HIT' : 'MISS');
      return result;
    };
    
    memoryStore.set = async function<T>(key: string, value: any, ttl: number) {
      setCalls++;
      setKeys.push(key);
      console.log(`[STORE SET #${setCalls}] Key: ${key}`);
      console.log(`[STORE SET #${setCalls}] Value:`, value);
      console.log(`[STORE SET #${setCalls}] TTL: ${ttl}`);
      await originalSet<T>(key, value, ttl);
      console.log(`[STORE SET #${setCalls}] Completed`);
    };

    const cache = apiCache({
      ttl: 300,
      useMemory: true,
      useRedis: false,
      cachePostPredicate: () => true,
      logger: {
        debug: (msg: string, ...args: any[]) => {
          console.log(`[MIDDLEWARE DEBUG] ${msg}`, ...args);
        },
        warn: (msg: string, ...args: any[]) => {
          console.log(`[MIDDLEWARE WARN] ${msg}`, ...args);
        },
        error: (msg: string, ...args: any[]) => {
          console.log(`[MIDDLEWARE ERROR] ${msg}`, ...args);
        }
      }
    });

    const testReq = {
      method: 'POST',
      url: '/api/test',
      path: '/api/test',
      body: { data: 'test' }
    };

    const testResponse = { result: 'success' };

    console.log('=== FIRST REQUEST ===');
    
    const mockRes1: any = {
      json: jest.fn().mockImplementation((data: any) => {
        console.log('[RESPONSE] mockRes1.json called with:', data);
        return mockRes1;
      }),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    let next1Called = false;
    const next1 = jest.fn(() => {
      console.log('[HANDLER] next() called for first request');
      next1Called = true;
      // Simulate async handler
      setImmediate(() => {
        console.log('[HANDLER] Sending response for first request');
        mockRes1.json(testResponse);
      });
    });

    console.log('[TEST] Calling middleware for first request...');
    await cache(testReq, mockRes1, next1);
    
    // Give some time for async operations
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('[TEST] First request completed');
    console.log('[TEST] Handler called:', next1Called);
    console.log('[TEST] Store GET calls so far:', getCalls);
    console.log('[TEST] Store SET calls so far:', setCalls);

    console.log('\\n=== SECOND REQUEST ===');
    
    const mockRes2: any = {
      json: jest.fn().mockImplementation((data: any) => {
        console.log('[RESPONSE] mockRes2.json called with:', data);
        return mockRes2;
      }),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    let next2Called = false;
    const next2 = jest.fn(() => {
      console.log('[HANDLER] ERROR: next() called for second request - cache miss!');
      next2Called = true;
      setImmediate(() => {
        mockRes2.json(testResponse);
      });
    });

    console.log('[TEST] Calling middleware for second request...');
    await cache(testReq, mockRes2, next2);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('[TEST] Second request completed');
    console.log('[TEST] Handler called for second request:', next2Called);
    console.log('[TEST] Total store GET calls:', getCalls);
    console.log('[TEST] Total store SET calls:', setCalls);
    console.log('[TEST] GET keys:', getKeys);
    console.log('[TEST] SET keys:', setKeys);
    
    if (!next2Called) {
      console.log('[TEST] SUCCESS: Second request hit cache!');
    } else {
      console.log('[TEST] ERROR: Second request missed cache!');
    }
    
    // Check store state
    const storeStats = memoryStore.stats();
    console.log('[TEST] Final store stats:', storeStats);
  });
});
