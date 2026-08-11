import type { Middleware } from "openapi-fetch";

/** 5xx: the request may or may not have been processed — only safe to repeat if it is idempotent. */
const RETRYABLE_SERVER_STATUSES = [500, 502, 503, 504];

/**
 * Methods that can be repeated without creating anything twice. Every POST on this API either
 * generates an asset, queues a batch or duplicates a template — all of which consume credits, so
 * none of them are repeated automatically. A 504 at the gateway does NOT mean the generation did
 * not happen.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `Retry-After` in milliseconds — the header is either delta-seconds or an HTTP date.
 * Returns null when absent or unparseable.
 */
function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Retry middleware.
 *
 * Two rules, both narrower than "retry every 429 and 5xx":
 *
 * - **429 is only retried when the response carries `Retry-After`.** On this API a bare 429 is
 *   not a rate limit — it is `rate_limit_exceeded`, which the edge also returns for "not enough
 *   credits" and for plan gates (HTML5/MP4/PDF not included). Those are permanent: retrying
 *   burns ~7s of backoff and fails anyway. A real throttle says when to come back.
 * - **5xx is only retried for idempotent methods.** A retried POST can bill a second generation.
 */
export function retryMiddleware(maxRetries: number): Middleware {
  return {
    async onResponse({ response, request }) {
      const isThrottle = response.status === 429;
      const serverError = RETRYABLE_SERVER_STATUSES.includes(response.status);
      if (!isThrottle && !serverError) return;
      if (serverError && !IDEMPOTENT_METHODS.has(request.method.toUpperCase())) return;

      let after = retryAfterMs(response);
      if (isThrottle && after === null) return;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Honour `Retry-After` when the server sent one, else exponential backoff with jitter:
        // 1s, 2s, 4s … ± up to 100ms.
        const delay = after ?? 2 ** (attempt - 1) * 1000 + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));

        const retried = await fetch(request.clone());
        if (retried.status !== 429 && !RETRYABLE_SERVER_STATUSES.includes(retried.status)) return retried;

        // If this was the last attempt, return the last response as-is
        if (attempt === maxRetries) return retried;
        after = retryAfterMs(retried);
        if (retried.status === 429 && after === null) return retried;
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
