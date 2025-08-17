import { sha256 } from './hash';
import type { ApiCacheOptions } from '../config';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url, 'http://placeholder');
    return u.pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export function sortQueryParams(url: string): string {
  try {
    const u = new URL(url, 'http://placeholder');
    const entries = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([k, v]) => `${k}=${v}`).join('&');
  } catch {
    return '';
  }
}

export function buildCacheKey(
  req: any,
  options: Required<Pick<ApiCacheOptions, 'getUserId'>>,
): string {
  const method = (req.method || 'GET').toUpperCase();
  const url = req.originalUrl || req.url || '';
  const norm = normalizeUrl(url);
  const sortedQuery = sortQueryParams(url);
  const userId = options.getUserId?.(req) || 'anon';

  let bodyHash = '';
  if (method !== 'GET') {
    try {
      const body = req.body ?? {};
      bodyHash = sha256(body);
    } catch {
      bodyHash = 'no-body';
    }
  }

  return [method, norm, sortedQuery, bodyHash, userId].join(':');
}
