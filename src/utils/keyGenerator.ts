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
  options: Required<Pick<ApiCacheOptions, 'getUserId'>> & Pick<ApiCacheOptions, 'graphQLKeyGenerator'>,
): string {
  // Check for custom GraphQL key generator
  if (isGraphQLRequest(req) && options.graphQLKeyGenerator) {
    const customKey = options.graphQLKeyGenerator(req);
    if (customKey) return customKey;
  }

  const method = (req.method || 'GET').toUpperCase();
  const url = req.originalUrl || req.url || '';
  const norm = normalizeUrl(url);
  const sortedQuery = sortQueryParams(url);
  const userId = options.getUserId?.(req) || 'anon';

  let bodyHash = '';
  if (method !== 'GET') {
    try {
      const body = req.body ?? {};
      // Special handling for GraphQL
      if (isGraphQLRequest(req)) {
        bodyHash = generateGraphQLHash(body);
      } else {
        bodyHash = sha256(body);
      }
    } catch {
      bodyHash = 'no-body';
    }
  }

  return [method, norm, sortedQuery, bodyHash, userId].join(':');
}

function isGraphQLRequest(req: any): boolean {
  const url = req.originalUrl || req.url || '';
  const isGraphQLPath = url.includes('/graphql') || url.includes('/graph');
  const hasGraphQLBody = req.body && (req.body.query || req.body.operationName);
  return isGraphQLPath || hasGraphQLBody;
}

function generateGraphQLHash(body: any): string {
  // For GraphQL, create a deterministic hash based on query, variables, and operationName
  const { query, variables, operationName } = body;
  
  // Normalize the query by removing extra whitespace
  const normalizedQuery = query ? query.replace(/\s+/g, ' ').trim() : '';
  
  // Sort variables keys for consistent hashing
  let sortedVariables = '';
  if (variables && typeof variables === 'object') {
    const sortedKeys = Object.keys(variables).sort();
    sortedVariables = JSON.stringify(
      sortedKeys.reduce((acc, key) => ({ ...acc, [key]: variables[key] }), {})
    );
  }
  
  const graphqlData = {
    query: normalizedQuery,
    variables: sortedVariables,
    operationName: operationName || ''
  };
  
  return sha256(graphqlData);
}
