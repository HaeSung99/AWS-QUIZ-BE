import { Request } from 'express';

/** 프록시 뒤에서 X-Forwarded-For 첫 홉, 없으면 소켓 주소 */
export function extractClientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim().length > 0) {
    return xf.split(',')[0].trim().slice(0, 128);
  }
  const raw = req.socket?.remoteAddress ?? '';
  return raw.replace(/^::ffff:/, '').slice(0, 128) || '0.0.0.0';
}
