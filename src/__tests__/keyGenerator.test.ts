import { buildCacheKey, normalizeUrl, sortQueryParams } from '../utils/keyGenerator';

describe('keyGenerator', () => {
  test('normalizes url and sorts query', () => {
    const url = '/path?b=2&a=1';
    expect(normalizeUrl(url)).toBe('/path');
    expect(sortQueryParams(url)).toBe('a=1&b=2');
  });

  test('builds key with body hash and user', () => {
    const req: any = {
      method: 'POST',
      originalUrl: '/search?q=1',
      body: { z: 2, a: 1 },
      user: { id: 'u1' },
    };
    const key = buildCacheKey(req, { getUserId: (r) => r.user.id });
    expect(key.startsWith('POST:/search:q=1:')).toBe(true);
    expect(key.endsWith(':u1')).toBe(true);
  });
});
