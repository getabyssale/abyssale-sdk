import type { Middleware } from "openapi-fetch";

const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/**
 * Exponential backoff retry middleware.
 * Retries on 429 / 5xx responses up to `maxRetries` times.
 */
export function retryMiddleware(maxRetries: number): Middleware {
  return {
    async onResponse({ response, request }) {
      if (!RETRYABLE_STATUSES.includes(response.status)) return;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Exponential backoff with jitter: 1s, 2s, 4s … ± up to 100ms
        const delay = 2 ** (attempt - 1) * 1000 + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));

        const retried = await fetch(request.clone());
        if (!RETRYABLE_STATUSES.includes(retried.status)) return retried;

        // If this was the last attempt, return the last response as-is
        if (attempt === maxRetries) return retried;
      }
    },
  };
}

/**
 * Request timeout middleware.
 * Aborts the request if it has not completed within `timeoutMs` milliseconds.
 * Uses AbortSignal.timeout() (no timer leak) and AbortSignal.any() to also
 * honour any AbortSignal the caller may have attached to the request.
 */
export function timeoutMiddleware(timeoutMs: number): Middleware {
  return {
    onRequest({ request }) {
      const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
      if (request.signal) signals.push(request.signal);
      const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
      return new Request(request, { signal });
    },
  };
}
