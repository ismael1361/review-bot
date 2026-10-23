export type RateLimiter = { check(key: string): boolean };

export function createRateLimiter(options: { max: number; windowMs: number; maxEntries?: number; now?: () => number }): RateLimiter {
  const maxEntries = options.maxEntries ?? 10_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const now = () => (options.now ?? Date.now)();
  const sweep = (at: number) => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) {
        buckets.delete(key);
      }
    }
  };
  return {
    check(key) {
      const at = now();
      if (buckets.size >= maxEntries) {
        sweep(at);
      }
      const bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxEntries) {
          return false;
        }
        buckets.set(key, { count: 1, resetAt: at + options.windowMs });
        return true;
      }
      if (bucket.resetAt <= at) {
        buckets.set(key, { count: 1, resetAt: at + options.windowMs });
        return true;
      }
      if (bucket.count >= options.max) {
        return false;
      }
      bucket.count += 1;
      return true;
    },
  };
}
