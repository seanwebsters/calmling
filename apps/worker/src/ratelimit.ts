/** Fixed-window rate limiting. Redis when configured, in-memory otherwise. */
export interface RateLimiter {
  kind: 'redis' | 'memory';
  hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number; retryAfterSec: number }>;
  publish?(channel: string, message: string): Promise<void>;
  close(): Promise<void>;
}

export function memoryLimiter(): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    kind: 'memory',
    async hit(key, limit, windowSec) {
      const now = Date.now();
      let w = windows.get(key);
      if (!w || w.resetAt <= now) {
        w = { count: 0, resetAt: now + windowSec * 1000 };
        windows.set(key, w);
      }
      w.count++;
      if (windows.size > 50_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
      return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
    },
    async close() {},
  };
}

export async function redisLimiter(url: string): Promise<RateLimiter> {
  const { Redis } = await import('ioredis');
  const r = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  await r.connect();
  return {
    kind: 'redis',
    async hit(key, limit, windowSec) {
      const k = `rl:${key}`;
      const res = await r.multi().incr(k).expire(k, windowSec, 'NX').ttl(k).exec();
      const count = Number(res?.[0]?.[1] ?? 0);
      const ttl = Number(res?.[2]?.[1] ?? windowSec);
      return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: Math.max(1, ttl) };
    },
    async publish(channel, message) {
      await r.publish(channel, message);
    },
    async close() {
      r.disconnect();
    },
  };
}
