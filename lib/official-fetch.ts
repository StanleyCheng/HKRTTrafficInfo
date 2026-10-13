import { waitForRequest } from './request-wait.ts';

type OfficialFetchOptions = {
  timeoutMs?: number;
  retryTimeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  signal?: AbortSignal;
};

// Rate-limited and permanent client errors wait for the next scheduled refresh.
const retryableStatus = new Set([408, 425, 500, 502, 503, 504]);

/** Buffer the body inside the attempt so a dropped/stalled download can retry too. */
export async function fetchOfficial(url: string, options: OfficialFetchOptions = {}): Promise<Response> {
  const retries = options.retries ?? 1;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timeout = setTimeout(() => controller.abort(new DOMException('Official feed timed out', 'TimeoutError')),
      attempt === 0 ? options.timeoutMs ?? 20000 : options.retryTimeoutMs ?? 8000);
    let shouldRetry = true;
    try {
      const response = await waitForRequest(fetch(url, { signal, headers: { Accept: '*/*' } }), signal);
      if (!response.ok) {
        shouldRetry = retryableStatus.has(response.status);
        void response.body?.cancel().catch(() => {});
        throw new Error(`官方資料服務回應 HTTP ${response.status}`);
      }
      const bytes = await waitForRequest(response.arrayBuffer(), signal);
      signal.throwIfAborted();
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      options.signal?.throwIfAborted();
      last = controller.signal.aborted ? controller.signal.reason : error;
    } finally {
      clearTimeout(timeout);
    }
    if (!shouldRetry || attempt === retries) break;
    const delay = new Promise(resolve => setTimeout(resolve, options.backoffMs ?? 250));
    await (options.signal ? waitForRequest(delay, options.signal) : delay);
  }
  throw new Error(last instanceof Error && last.name === 'TimeoutError'
    ? '官方資料服務回應逾時，請稍後再試。'
    : `暫時無法連接官方資料服務。${last instanceof Error ? last.message : ''}`);
}
