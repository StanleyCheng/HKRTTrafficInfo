/** Failed requests wait 30s, 60s, 120s, 240s, then at most five minutes. */
export class RefreshBackoff {
  private failures = new Map<string, { count: number; retryAt: number }>()

  due(key: string, now = Date.now()): boolean {
    return now >= (this.failures.get(key)?.retryAt ?? 0)
  }

  fail(key: string, now = Date.now()): void {
    const count = Math.min((this.failures.get(key)?.count ?? 0) + 1, 5)
    if (!this.failures.has(key) && this.failures.size >= 2048) {
      const oldest = this.failures.keys().next().value
      if (oldest !== undefined) this.failures.delete(oldest)
    }
    this.failures.set(key, { count, retryAt: now + Math.min(30_000 * 2 ** (count - 1), 300_000) })
  }

  reset(key?: string): void {
    if (key === undefined) this.failures.clear()
    else this.failures.delete(key)
  }
}
