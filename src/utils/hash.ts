import crypto from 'crypto';

export function sha256(input: string | Buffer | object): string {
  const str =
    typeof input === 'string' || Buffer.isBuffer(input)
      ? input
      : JSON.stringify(sanitizeObject(input));
  const hash = crypto.createHash('sha256');
  hash.update(str as any);
  return hash.digest('hex');
}

function sanitizeObject(obj: any): any {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const out: any = {};
    for (const k of keys) out[k] = sanitizeObject(obj[k]);
    return out;
  }
  return obj;
}
