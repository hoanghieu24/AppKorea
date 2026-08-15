const stores = new Set();

function cleanupStore(store) {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) store.delete(key);
  }
  // Van an toàn chống Map phình vô hạn nếu bị quét rất nhiều IP khác nhau.
  if (store.size > 20000) {
    const entries = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < entries.length - 15000; i += 1) store.delete(entries[i][0]);
  }
}

const cleanupTimer = setInterval(() => {
  for (const store of stores) cleanupStore(store);
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

function defaultKey(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

export function createRateLimiter({ windowMs, max, keyGenerator = defaultKey, message = 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.' }) {
  const store = new Map();
  stores.add(store);

  return (req, res, next) => {
    const now = Date.now();
    const key = String(keyGenerator(req));
    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ message, retryAfter });
    }
    return next();
  };
}

export function createConcurrencyGuard({ max = 2, keyGenerator = defaultKey, message = 'Bạn đang có quá nhiều yêu cầu AI chạy cùng lúc.' }) {
  const active = new Map();

  return (req, res, next) => {
    const key = String(keyGenerator(req));
    const current = active.get(key) || 0;
    if (current >= max) {
      return res.status(429).json({ message });
    }

    active.set(key, current + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (active.get(key) || 1) - 1;
      if (left <= 0) active.delete(key);
      else active.set(key, left);
    };

    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}
