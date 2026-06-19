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
 * Request timeout middleware using AbortController.
 * Aborts the request if it has not completed within `timeoutMs` milliseconds.
 */
export function timeoutMiddleware(timeoutMs: number): Middleware {
  return {
    onRequest({ request }) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      // Clear the timeout if the request finishes before the deadline
      request.signal?.addEventListener("abort", () => clearTimeout(id));

      return new Request(request, { signal: controller.signal });
    },
  };
}
