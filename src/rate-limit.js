'use strict';

function createRateLimiter({ windowMs, publicLimit, adminLimit }) {
  const buckets = new Map();
  const maxBuckets = 5000;
  let checks = 0;
  return function check(key, isAdmin) {
    const now = Date.now();
    const limit = isAdmin ? adminLimit : publicLimit;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.delete(key);
    if (!buckets.has(key) && buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value);
    buckets.set(key, bucket);
    checks += 1;
    if (checks % 256 === 0) {
      for (const [id, value] of buckets) if (value.resetAt <= now) buckets.delete(id);
    }
    return { allowed: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
  };
}

module.exports = { createRateLimiter };
