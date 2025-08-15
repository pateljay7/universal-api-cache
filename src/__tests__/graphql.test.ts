import { apiCache } from '../middleware';

describe('GraphQL Caching', () => {
  let cache: any;
  let mockReq: any;
  let mockRes: any;
  let nextSpy: jest.Mock;

  beforeEach(() => {
    cache = apiCache({
      ttl: 60,
      useMemory: true,
      useRedis: false,
      cacheIntrospection: true,
      graphQLKeyGenerator: (req: any) => {
        if (!req.body?.query) return undefined;
        const { query, variables, operationName } = req.body;
        const userId = req.user?.id || 'anon';
        const opName = operationName || 'unnamed';
        return `graphql:${opName}:${JSON.stringify(variables || {})}:${userId}`;
      }
    });

    const jsonSpy = jest.fn().mockReturnThis();
    const sendSpy = jest.fn().mockReturnThis();
    
    mockRes = {
      json: jsonSpy,
      send: sendSpy,
      set: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    nextSpy = jest.fn();
  });

  describe('GraphQL Detection and Bypassing', () => {
    it('should not cache GraphQL mutations', async () => {
      mockReq = {
        method: 'POST',
        url: '/graphql',
        body: {
          query: 'mutation CreateUser($name: String!) { createUser(name: $name) { id name } }',
          variables: { name: 'Bob' },
          operationName: 'CreateUser'
        },
        user: { id: 'user1' }
      };

      await cache(mockReq, mockRes, nextSpy);

      expect(nextSpy).toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should not cache introspection queries when disabled', async () => {
      const cacheNoIntrospection = apiCache({
        ttl: 60,
        useMemory: true,
        useRedis: false,
        cacheIntrospection: false
      });

      mockReq = {
        method: 'POST',
        url: '/graphql',
        body: {
          query: 'query IntrospectionQuery { __schema { types { name } } }',
          variables: {},
          operationName: 'IntrospectionQuery'
        }
      };

      await cacheNoIntrospection(mockReq, mockRes, nextSpy);

      expect(nextSpy).toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('GraphQL Cache Key Generation', () => {
    it('should use custom GraphQL key generator', () => {
      const req = {
        method: 'POST',
        url: '/graphql',
        body: {
          query: 'query GetUsers { users { id name } }',
          variables: { limit: 10 },
          operationName: 'GetUsers'
        },
        user: { id: 'user1' }
      };

      // Test the key generator function directly
      const keyGen = cache.__options?.graphQLKeyGenerator;
      if (keyGen) {
        const key = keyGen(req);
        expect(key).toBe('graphql:GetUsers:{"limit":10}:user1');
      }
    });
  });
});
