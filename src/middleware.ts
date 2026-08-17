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
 * How long to wait before the single probe a bare `429` is given. See {@link planRetry}.
 *
 * Sized against the thing it is probing for: the global ceiling is 10 requests per **second**, so
 * one second is the shortest wait that reliably clears it, and waiting longer only lengthens the
 * failure when the refusal turns out to be permanent.
 */
export const CEILING_PROBE_DELAY_MS = 1_000;

/**
 * Error ids that answer `429` and are known to be permanent for this key, so not even the probe
 * below is worth spending.
 *
 * `rate_limit_exceeded` is deliberately NOT here even though it is permanent when it means "out of
 * credits" — see {@link planRetry} for why it cannot be classified from the id alone.
 */
const PERMANENT_429_CODES = new Set(["feature_not_in_plan"]);

/** The `id` from an error envelope, or null if the body is absent or not the envelope. */
export async function readErrorId(response: Response): Promise<string | null> {
  try {
    // Cloned: openapi-fetch reads the real body after the middleware chain returns.
    const body = await response.clone().json();
    return typeof body?.id === "string" ? body.id : null;
  } catch {
    return null;
  }
}

/** How a response should be re-attempted, or null when it should not be. */
export type RetryPlan = {
  /** true = exactly one attempt, whatever `maxRetries` says. See {@link planRetry}. */
  probe: boolean;
  /** Fixed wait before the first attempt; null means use the exponential schedule. */
  delayMs: number | null;
};

/**
 * Whether a response is worth asking for again, ignoring the request method.
 *
 * The single derivation of that question, used by {@link retryMiddleware} and by the polling
 * helpers in `index.ts`. They used to answer it separately and had already drifted. Anything
 * method-sensitive (a 5xx on a POST) stays with the caller — a poll is always a GET, so only the
 * middleware has that concern.
 *
 * `429` is the hard case, because **three unrelated refusals share the status and two of them
 * share an id**:
 *
 * - `request_rate_limited` — the per-workspace endpoint budget. The edge sends `Retry-After`
 *   alongside it, so it is unambiguous and gets the full retry ladder.
 * - `feature_not_in_plan` — your plan excludes this design type. Permanent; never retried.
 * - `rate_limit_exceeded` — **two different things under one id.** Either the plan's credits are
 *   spent (permanent), or the gateway's global 10 req/s ceiling was hit (clears in under a
 *   second). Only `message` distinguishes them, and the ceiling is enforced at the GATEWAY, one
 *   layer above the edge, so its response carries neither `Retry-After` nor reliably the edge's
 *   envelope at all.
 *
 * That last case is why a bare `429` is not simply fatal. Treating it as permanent — which this
 * did — means a burst of parallel generation calls fails outright, and generation endpoints are
 * in no tier, so the ceiling is the ONLY limit they can hit. Treating it as fully retryable, which
 * it did before that, spent ~7s of backoff on refusals that never clear.
 *
 * So it gets exactly **one** probe after a fixed second. Being wrong costs one second on a call
 * that was failing anyway; being right rescues a call that would otherwise have failed outright.
 * That asymmetry, not a confident classification, is the argument.
 */
export function planRetry(response: Response, errorId?: string | null): RetryPlan | null {
  if (RETRYABLE_SERVER_STATUSES.includes(response.status))
    return { probe: false, delayMs: retryAfterMs(response) };
  if (response.status !== 429) return null;

  const after = retryAfterMs(response);
  // It told us when to come back, so it is a real throttle and we believe it.
  if (after !== null) return { probe: false, delayMs: after };
  if (errorId && PERMANENT_429_CODES.has(errorId)) return null;
  return { probe: true, delayMs: CEILING_PROBE_DELAY_MS };
}

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
 * Retry middleware.
 *
 * Three rules, all narrower than "retry every 429 and 5xx":
 *
 * - **5xx is only retried for idempotent methods.** A retried POST can bill a second generation.
 * - **A 429 carrying `Retry-After` gets the full ladder** — it named a window, so it is a real
 *   throttle and waiting is exactly the right response.
 * - **A bare 429 gets one probe**, one second later. See {@link planRetry} for why a status this
 *   overloaded cannot be classified confidently, and why the asymmetric cost of guessing wrong
 *   settles it.
 *
 * `timeoutMs` is the same value given to {@link timeoutMiddleware}: each attempt is dispatched with
 * its own fresh timeout window, so a long `Retry-After` no longer eats into the budget of the
 * request that follows it.
 */
export function retryMiddleware(maxRetries: number, timeoutMs: number): Middleware {
  return {
    async onResponse({ response, request }) {
      // The body is only read for a bare 429, where the id can rule the retry out entirely.
      const plan = planRetry(response, response.status === 429 ? await readErrorId(response) : null);
      if (!plan) return;
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

      let after = plan.delayMs;
      // A probe is one attempt by definition — it exists to find out whether the refusal clears,
      // not to wait one out, so it does not scale with `maxRetries`. It is still CAPPED by it:
      // `ABYSSALE_MAX_RETRIES=0` means retries are off, and a probe is a retry.
      const attempts = plan.probe ? Math.min(1, maxRetries) : maxRetries;

      const callerSignal = state?.callerSignal;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        // Honour the plan's fixed delay when there is one, else exponential backoff with jitter:
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
        // If this was the last attempt, hand back what we got — no need to classify it.
        if (attempt === attempts) return retried;

        // Same classification as the entry check. A success or a verdict ends the loop and is
        // handed back as-is; so does a bare 429 arriving here, because its probe was this attempt.
        const next = planRetry(retried, retried.status === 429 ? await readErrorId(retried) : null);
        if (!next || next.probe) return retried;
        after = next.delayMs;
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
