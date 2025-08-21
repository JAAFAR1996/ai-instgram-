export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class ExpiringMap<K, V> {
  private map = new Map<K, CacheEntry<V>>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private cleanupMs = 60_000) {
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs);
    // Allow process to exit if this is the only active timer
    this.cleanupInterval.unref?.();
  }

  set(key: K, value: V, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.map.set(key, { value, expiresAt });
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
      }
    }
  }
}