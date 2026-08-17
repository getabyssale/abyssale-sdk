import type { Middleware } from "openapi-fetch";

/**
 * 5xx: the request may or may not have been processed — only safe to repeat if it is idempotent.
 * Exported so the polling loop in `index.ts` classifies a transient poll failure the same way this
 * middleware does, instead of keeping a second list that can drift from this one.
 */
export const RETRYABLE_SERVER_STATUSES = [500, 502, 503, 504];

/**
 * Methods that can be repeated without creating anything twice. Every POST on this API either
 * generates an asset, queues a batch or duplicates a template — all of which consume credits, so
 * none of them are repeated automatically. A 504 at the gateway does NOT mean the generation did
 * not happen.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The caller's own `AbortSignal`, keyed by the request `timeoutMiddleware` produced from it.
 *
 * A retry needs to re-arm the timeout — `AbortSignal.timeout` starts counting at creation, so
 * reusing the first attempt's signal makes one window cover every attempt plus the backoff sleeps
 * between them. But it must still honour a caller who aborts. Once the two are composed with
 * `AbortSignal.any` they cannot be taken apart again, so the caller's half is stashed here before
 * composing. Keyed on the `Request` instance (which openapi-fetch passes unchanged from
 * `onRequest` to `onResponse`) and weakly held, so nothing needs cleaning up.
 */
const callerSignals = new WeakMap<Request, AbortSignal>();

/** Compose a fresh `timeoutMs` window with the caller's signal, if any. */
function withTimeoutSignal(request: Request, timeoutMs: number, callerSignal?: AbortSignal): Request {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (callerSignal) signals.push(callerSignal);
  return new Request(request, { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
}

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
 * - **429 is only retried when the response carries `Retry-After`.** Three unrelated refusals
 *   answer 429 here and only one is worth repeating. `request_rate_limited` is a genuine
 *   throttle — too many requests for the route's tier — and the edge sends `Retry-After`
 *   alongside `X-RateLimit-Limit` / `-Remaining` / `-Reset`, so it retries. `rate_limit_exceeded`
 *   ("not enough credits", or the gateway's global ceiling) and `feature_not_in_plan` carry no
 *   such header and are permanent for this key: retrying burns ~7s of backoff and fails anyway.
 *   Keying on the header rather than on `id` is deliberate — the classification then cannot drift
 *   as codes are added, because a refusal that tells you when to come back is one worth repeating.
 * - **5xx is only retried for idempotent methods.** A retried POST can bill a second generation.
 *
 * `timeoutMs` is the same value given to {@link timeoutMiddleware}: each attempt is dispatched with
 * its own fresh timeout window, so a long `Retry-After` no longer eats into the budget of the
 * request that follows it.
 */
export function retryMiddleware(maxRetries: number, timeoutMs: number): Middleware {
  return {
    async onResponse({ response, request }) {
      const isThrottle = response.status === 429;
      const serverError = RETRYABLE_SERVER_STATUSES.includes(response.status);
      if (!isThrottle && !serverError) return;
      if (serverError && !IDEMPOTENT_METHODS.has(request.method.toUpperCase())) return;

      let after = retryAfterMs(response);
      if (isThrottle && after === null) return;

      const callerSignal = callerSignals.get(request);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Honour `Retry-After` when the server sent one, else exponential backoff with jitter:
        // 1s, 2s, 4s … ± up to 100ms.
        const delay = after ?? 2 ** (attempt - 1) * 1000 + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
        // A caller who gave up during the backoff should not be charged another attempt.
        if (callerSignal?.aborted) return;

        // Deliberately a bare `fetch`, not the client: re-entering the chain would recurse into
        // this middleware. That means the timeout has to be re-applied by hand — every attempt gets
        // its own `timeoutMs`, measured from its own dispatch, rather than inheriting a window that
        // opened before the first attempt and the backoff sleeps since.
        const retried = await fetch(withTimeoutSignal(request.clone(), timeoutMs, callerSignal));
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
 *
 * `timeoutMs` is per attempt, not per call: {@link retryMiddleware} re-arms it for each retry.
 */
export function timeoutMiddleware(timeoutMs: number): Middleware {
  return {
    onRequest({ request }) {
      const callerSignal = request.signal ?? undefined;
      const withTimeout = withTimeoutSignal(request, timeoutMs, callerSignal);
      if (callerSignal) callerSignals.set(withTimeout, callerSignal);
      return withTimeout;
    },
  };
}
