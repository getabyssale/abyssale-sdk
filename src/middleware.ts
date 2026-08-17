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
 * What a retry needs that it cannot recover from the request it is handed in `onResponse`.
 *
 * Keyed on the `Request` instance openapi-fetch passes unchanged from `onRequest` to `onResponse`,
 * and weakly held, so nothing needs cleaning up. Two entries, both of which have to be captured
 * *before* the request is dispatched:
 *
 * - `callerSignal` — a retry re-arms the timeout, because `AbortSignal.timeout` starts counting at
 *   creation and reusing the first attempt's signal would make one window cover every attempt plus
 *   the backoff sleeps between them. But it must still honour a caller who aborts, and once the two
 *   are composed with `AbortSignal.any` they cannot be taken apart again — hence the stash.
 * - `replayable` — a clone taken while the body is still readable. By the time `onResponse` runs,
 *   `fetch` has consumed the request stream and `request.clone()` throws `TypeError: unusable`, so
 *   every retried POST used to reject instead of returning its `{data, error}`. A clone is itself
 *   single-use, so this one is never dispatched: each attempt clones it again.
 */
type RequestState = { callerSignal?: AbortSignal; replayable: Request };
const requestState = new WeakMap<Request, RequestState>();

/** Compose a fresh `timeoutMs` window with the caller's signal, if any. */
function withTimeoutSignal(request: Request, timeoutMs: number, callerSignal?: AbortSignal): Request {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (callerSignal) signals.push(callerSignal);
  return new Request(request, { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
}

/**
 * `Retry-After` in milliseconds — the header is either delta-seconds or an HTTP date.
 * Returns null when absent or unparseable.
 *
 * Exported so the polling loop can honour a throttle's own figure instead of overriding it with
 * its backoff schedule.
 */
export function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Whether a response is worth asking for again, ignoring the request method.
 *
 * The single derivation of that question, used by {@link retryMiddleware} and by the polling
 * helpers in `index.ts`. They used to answer it separately and had already drifted: the poll
 * retried every 429, including the ones that are permanent, while the middleware required
 * `Retry-After`. Anything method-sensitive (a 5xx on a POST) stays with the caller — a poll is
 * always a GET, so only the middleware has that concern.
 */
export function isRetryableResponse(response: Response): boolean {
  if (RETRYABLE_SERVER_STATUSES.includes(response.status)) return true;
  // A 429 is only worth repeating when it says when to come back. See `retryMiddleware`.
  return response.status === 429 && retryAfterMs(response) !== null;
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
      if (!isRetryableResponse(response)) return;
      // Method-sensitive, so it stays here rather than in the shared predicate: a 5xx on a write
      // may already have been processed.
      if (RETRYABLE_SERVER_STATUSES.includes(response.status) && !IDEMPOTENT_METHODS.has(request.method.toUpperCase()))
        return;

      // Normally stashed by `timeoutMiddleware`, which `createClient` always registers alongside
      // this one. Absent it, a bodyless request is still safe to replay from `request` itself —
      // there is no consumed stream to clone. A request WITH a body is not, so it is handed back
      // untouched rather than throwing `TypeError: unusable` at the caller.
      const state = requestState.get(request);
      const replayable = state?.replayable ?? (request.body === null ? request : null);
      if (!replayable) return;

      let after = retryAfterMs(response);

      const callerSignal = state?.callerSignal;

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
        //
        // Cloned off `replayable` rather than off `request`, whose body `fetch` already consumed,
        // and cloned again on every pass because a clone is single-use too.
        const retried = await fetch(withTimeoutSignal(replayable.clone(), timeoutMs, callerSignal));
        // Same predicate as the entry check — a success, a verdict, or a 429 that stopped saying
        // when to come back all end the loop and are handed back as-is.
        if (!isRetryableResponse(retried)) return retried;

        // If this was the last attempt, return the last response as-is
        if (attempt === maxRetries) return retried;
        after = retryAfterMs(retried);
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
      // Clone here, while the body is still readable — see {@link requestState}. This runs on every
      // request, not just the retryable ones, because whether a retry is needed is only known after
      // the response arrives, by which point the body is gone.
      requestState.set(withTimeout, { callerSignal, replayable: withTimeout.clone() });
      return withTimeout;
    },
  };
}
