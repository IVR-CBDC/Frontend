import NodeCache from "node-cache";

// Central cache for the BFF layer. Aggregated read models (e.g. the dashboard
// summary) are expensive to recompute on every request, so the BFF caches
// them for a short TTL and invalidates on writes.
export const bffCache = new NodeCache({ stdTTL: 15, checkperiod: 5 });

export function invalidate(prefix: string): void {
  const keys = bffCache.keys().filter((k) => k.startsWith(prefix));
  bffCache.del(keys);
}
