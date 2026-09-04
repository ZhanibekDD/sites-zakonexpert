'use strict';



function createRateLimits() {
  function createRateLimiter({ windowMs, max, name }) {
    const buckets = new Map();
    let lastSweep = 0;
    return (req, res, next) => {
      const now = Date.now();
      if (now - lastSweep > windowMs) {
        for (const [key, value] of buckets) {
          if (now - value.startedAt >= windowMs) buckets.delete(key);
        }
        lastSweep = now;
      }
      const key = req.ip || req.socket.remoteAddress || 'unknown';
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.startedAt >= windowMs) {
        bucket = { count: 0, startedAt: now };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > max) {
        res.set('Retry-After', String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
        return res.status(429).json({ error: `Слишком много запросов к ${name}. Повторите позже.` });
      }
      next();
    };
  }

  const externalApiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, name: 'внешнему реестру' });
  const housingSearchLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12, name: 'поиску по жилищным спискам' });
  const housingRecordsLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, name: 'спискам открытых данных' });
  const companySuggestLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, name: 'поиску организаций' });
  const leadLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, name: 'форме' });
  const commentLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, name: 'комментариям' });

  return { externalApiLimiter, housingSearchLimiter, housingRecordsLimiter, companySuggestLimiter, leadLimiter, commentLimiter };
}

module.exports = { createRateLimits };
