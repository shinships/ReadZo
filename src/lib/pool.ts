// Concurrency + retry helpers shared by translation and TTS generation.

interface RetryOptions {
  retries?: number;
  baseMs?: number;
}

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  const status = e?.status ?? e?.code;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
  return /rate|quota|overload|timeout|429|503|unavailable|deadline/i.test(e?.message || '');
}

// Retry a promise-returning fn with exponential backoff, but only for transient
// errors (429 / 5xx / rate-limit). Non-retryable errors (e.g. 400) throw immediately.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const delay = baseMs * 2 ** attempt + Math.random() * 300;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Run fn over items with bounded concurrency, preserving result order by index.
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
