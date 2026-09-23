import type { TrafficResource } from "@/lib/accountTraffic";

/** Small process-local cache of public resource metadata, never visitor data. */
export function createTrafficContextCache(now = Date.now, capacity = 128) {
  const entries = new Map<string, { until: number; pending: Promise<TrafficResource[]> }>();
  return async (key: string, load: () => Promise<TrafficResource[]>) => {
    const current = entries.get(key);
    if (current && current.until > now()) return current.pending;
    if (entries.size >= capacity) {
      for (const [entryKey, value] of entries) if (value.until <= now()) entries.delete(entryKey);
      if (entries.size >= capacity) entries.delete(entries.keys().next().value!);
    }
    const entry = { until: now() + 30000, pending: Promise.resolve([] as TrafficResource[]) };
    entry.pending = Promise.resolve().then(load).then((resources) => {
      if (entries.get(key) === entry) {
        // Large catalogs are still resolved fully; simply do not retain them.
        if (resources.length > 2000) entries.delete(key);
        else entry.until = now() + (resources.length ? 30000 : 5000);
      }
      return resources;
    }).catch((error) => { if (entries.get(key) === entry) entries.delete(key); throw error; });
    entries.set(key, entry);
    return entry.pending;
  };
}
export const cachedTrafficContext = createTrafficContextCache();
