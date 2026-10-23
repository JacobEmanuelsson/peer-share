// A single-instance, bounded sliding window. HTTP limits are enforced separately.
export function createBudget(max: number, windowMs: number, now = Date.now) {
  const buckets = new Map<string, { count: number; until: number }>();
  return (key: string) => {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) {
      if (buckets.size >= 10000) for (const [id, entry] of buckets) if (entry.until <= time) buckets.delete(id);
      if (!bucket && buckets.size >= 10000) return false;
      bucket = { count: 0, until: time + windowMs }; buckets.set(key, bucket);
    }
    return ++bucket.count <= max;
  };
}