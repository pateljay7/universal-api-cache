import { apiCache } from '../middleware';

describe('POST Request Cache Debug', () => {
  it('should debug POST request caching flow', async () => {
    const cache = apiCache({
      ttl: 300,
      useMemory: true,
      useRedis: false,
      cachePostPredicate: () => true, // Cache all POST requests
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

    const testReq = {
      method: 'POST',
      url: '/api/search',
      path: '/api/search',
      body: { q: 'test query' }
    };

    const testResponse = { results: ['item1', 'item2'], count: 2 };

    console.log('=== FIRST POST REQUEST ===');
    
    const mockRes1: any = {
      json: jest.fn().mockImplementation((data: any) => {
        console.log('mockRes1.json called with:', data);
        return mockRes1;
      }),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    let nextCalled1 = false;
    const next1 = jest.fn(() => {
      console.log('next() called for first POST request');
      nextCalled1 = true;
      setTimeout(() => {
        console.log('Simulating POST response');
        mockRes1.json(testResponse);
      }, 10);
    });

    await cache(testReq, mockRes1, next1);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('First POST request completed');
    console.log('next() was called:', nextCalled1);

    console.log('=== SECOND POST REQUEST (should hit cache) ===');
    
    const mockRes2: any = {
      json: jest.fn().mockImplementation((data: any) => {
        console.log('mockRes2.json called with:', data);
        return mockRes2;
      }),
      send: jest.fn(),
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    let nextCalled2 = false;
    const next2 = jest.fn(() => {
      console.log('ERROR: next() called for second POST request - cache miss!');
      nextCalled2 = true;
      setTimeout(() => {
        mockRes2.json(testResponse);
      }, 10);
    });

    await cache(testReq, mockRes2, next2);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('Second POST request completed');
    console.log('next() was called for second request:', nextCalled2);
    
    if (!nextCalled2) {
      console.log('SUCCESS: Second POST request hit cache!');
    } else {
      console.log('ERROR: Second POST request missed cache!');
    }
  });
});
