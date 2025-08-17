import { apiCache } from '../middleware';

describe('Detailed Cache Flow Debug', () => {
  it('should trace the complete cache flow step by step', async () => {
    const cache = apiCache({
      ttl: 300,
      useMemory: true,
      useRedis: false,
      cachePostPredicate: (req) => req.url === '/api/search',
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
      body: {
        query: 'test search',
        filters: {},
        limit: 10
      }
    };

    const testResponse = { data: { results: ['item1', 'item2'] } };

    console.log('=== FIRST REQUEST - SHOULD CACHE ===');
    
    // First request
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
      console.log('next() called for first request');
      nextCalled1 = true;
      // Simulate the API resolver responding
      setTimeout(() => {
        console.log('Simulating async API response');
        mockRes1.json(testResponse);
      }, 10);
    });

    console.log('Calling middleware for first request...');
    await cache(testReq, mockRes1, next1);
    
    // Wait for async response
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('First request completed');
    console.log('next() was called:', nextCalled1);
    console.log('mockRes1.json was called:', mockRes1.json.mock?.calls?.length || 'N/A', 'times');

    console.log('=== SECOND REQUEST - SHOULD HIT CACHE ===');
    
    // Second identical request
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
      console.log('ERROR: next() called for second request - cache miss!');
      nextCalled2 = true;
      setTimeout(() => {
        mockRes2.json(testResponse);
      }, 10);
    });

    console.log('Calling middleware for second request...');
    await cache(testReq, mockRes2, next2);
    
    // Wait for async response
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('Second request completed');
    console.log('next() was called for second request:', nextCalled2);
    console.log('mockRes2.json was called:', mockRes2.json.mock?.calls?.length || 'N/A', 'times');
    
    if (nextCalled2) {
      console.log('ERROR: Second request did not hit cache!');
    } else {
      console.log('SUCCESS: Second request hit cache!');
    }
  });
});
