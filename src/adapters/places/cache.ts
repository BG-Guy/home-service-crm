// Tiny in-memory LRU with a TTL for autocomplete answers. A Map keeps insertion
// order, so a hit is moved to the end and the first key is the least recently used.

export interface Lru<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
}

export function createLru<V>(
  max: number,
  ttlMs: number,
  now: () => number = Date.now,
): Lru<V> {
  const map = new Map<string, { value: V; expires: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      map.delete(key);
      if (hit.expires <= now()) return undefined;
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, expires: now() + ttlMs });
      while (map.size > max) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
      }
    },
    get size() {
      return map.size;
    },
  };
}
