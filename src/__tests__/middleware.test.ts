import { describe, it, expect, vi, beforeEach } from "vitest";
import { retryMiddleware, timeoutMiddleware } from "../middleware.js";

// ── retryMiddleware ───────────────────────────────────────────────────────────

describe("retryMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not retry on 2xx responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(3, 30_000);
    const response = new Response(null, { status: 200 });
    const request = new Request("https://example.com");

    const result = await middleware.onResponse!({
      response,
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    expect(result).toBeUndefined(); // no retry — returns undefined (pass-through)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not retry on 4xx responses (except 429)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(3, 30_000);
    const response = new Response(null, { status: 404 });
    const request = new Request("https://example.com");

    const result = await middleware.onResponse!({
      response,
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes a bare 429 exactly once, whatever maxRetries says", async () => {
    // A bare 429 is ambiguous: `rate_limit_exceeded` covers BOTH a spent credit balance
    // (permanent) and the gateway's global 10 req/s ceiling (clears in under a second), and the
    // ceiling is enforced above the edge so it carries no `Retry-After` to tell them apart. One
    // probe costs a second when the refusal is permanent and rescues the call when it is not.
    // maxRetries is 3 here precisely to show the probe does not obey it.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 429 }));
    const middleware = retryMiddleware(3, 30_000);

    const promise = middleware.onResponse!({
      response: new Response(null, { status: 429 }),
      request: new Request("https://example.com"),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await promise)?.status).toBe(429);
  });

  it("waits a second before the probe — the ceiling is per second", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const middleware = retryMiddleware(3, 30_000);

    const promise = middleware.onResponse!({
      response: new Response(null, { status: 429 }),
      request: new Request("https://example.com"),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    await vi.advanceTimersByTimeAsync(900);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect((await promise)?.status).toBe(200);
  });

  it("does not probe a bare 429 whose id is permanent", async () => {
    // `feature_not_in_plan` says the plan excludes this design type. Unlike `rate_limit_exceeded`
    // it is unambiguous, so not even one second is worth spending on it.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(3, 30_000);

    const result = await middleware.onResponse!({
      response: new Response(JSON.stringify({ id: "feature_not_in_plan" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
      request: new Request("https://example.com"),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves the response body readable after inspecting its id", async () => {
    // The id is read off a CLONE — openapi-fetch parses the real body after the middleware chain
    // returns, and consuming it here would hand the caller an unreadable response.
    const middleware = retryMiddleware(3, 30_000);
    const response = new Response(JSON.stringify({ id: "feature_not_in_plan", message: "Upgrade" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });

    await middleware.onResponse!({
      response,
      request: new Request("https://example.com"),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    expect(await response.json()).toMatchObject({ id: "feature_not_in_plan", message: "Upgrade" });
  });

  it("does not retry a POST on 5xx — a repeat would bill a second generation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(3, 30_000);
    const result = await middleware.onResponse!({
      response: new Response(null, { status: 500 }),
      request: new Request("https://example.com", { method: "POST", body: "{}" }),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retries a 429 that carries Retry-After, and waits for it", async () => {
    const successResponse = new Response(null, { status: 200 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(successResponse);

    const middleware = retryMiddleware(3, 30_000);
    const response = new Response(null, { status: 429, headers: { "retry-after": "2" } });
    const request = new Request("https://example.com");

    const promise = middleware.onResponse!({
      response,
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result?.status).toBe(200);
  });

  it("retries on 500 up to maxRetries times then returns last response", async () => {
    const failResponse = new Response(null, { status: 500 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(failResponse);

    const middleware = retryMiddleware(2, 30_000);
    const response = new Response(null, { status: 500 });
    const request = new Request("https://example.com");

    const promise = middleware.onResponse!({
      response,
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result?.status).toBe(500);
  });

  it("gives each retry its own timeout window instead of one shared with the first attempt", async () => {
    // The bug: AbortSignal.timeout starts counting when it is created, so reusing the first
    // attempt's signal made a single window cover every attempt *and* the backoff sleeps between
    // them — three retries behind a 27s Retry-After aborted mid-retry despite a 30s timeout.
    //
    // Real timers, and a backoff (50ms) deliberately longer than the timeout (5ms): by the time the
    // retry is dispatched the *original* window has long expired. A retry that inherited it would
    // arrive already aborted.
    //
    // The two windows are deliberately different sizes: 5ms for the original so it is certainly
    // expired by the time the retry goes out, and a long one for the retry so a slow CI box cannot
    // expire it between its creation and the assertion. In real use both come from the same
    // ABYSSALE_TIMEOUT_MS; what is under test here is that the retry gets a *fresh* window.
    vi.useRealTimers();
    const abortedOnArrival: boolean[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      abortedOnArrival.push((input as Request).signal.aborted);
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const middleware = retryMiddleware(1, 30_000);
    // Route through onRequest first so the caller's signal is registered, as it is in real use.
    const request = timeoutMiddleware(5).onRequest!({
      request: new Request("https://example.com"),
      options: {},
      schemaPath: "",
      params: {},
    } as Parameters<NonNullable<ReturnType<typeof timeoutMiddleware>["onRequest"]>>[0]) as Request;

    const result = await middleware.onResponse!({
      // `Retry-After: 0.05` → a 50ms backoff, ten times the timeout window.
      response: new Response(null, { status: 500, headers: { "retry-after": "0.05" } }),
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(request.signal.aborted).toBe(true); // the first attempt's window did expire
    expect(abortedOnArrival).toEqual([false]); // …and the retry got a fresh one anyway
    expect(result?.status).toBe(200);
  });

  it("replays a request that carries a body, with the body intact", async () => {
    // The bug this pins: `request.clone()` used to be called in `onResponse`, by which point
    // `fetch` had consumed the request stream — so `clone()` threw `TypeError: unusable` and every
    // throttled POST *rejected* instead of returning its `{data, error}`. Bodyless requests were
    // fine, and every test in this file used to build one, which is how it shipped.
    const bodies: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      bodies.push(await (input as Request).text());
      return new Response(null, { status: 200 });
    });

    const payload = JSON.stringify({ name: "a project" });
    const middleware = retryMiddleware(3, 30_000);
    const request = timeoutMiddleware(30_000).onRequest!({
      request: new Request("https://example.com", { method: "POST", body: payload }),
      options: {},
      schemaPath: "",
      params: {},
    } as Parameters<NonNullable<ReturnType<typeof timeoutMiddleware>["onRequest"]>>[0]) as Request;
    // The dispatch openapi-fetch would have done. `.text()`, not `.clone().text()`: a real `fetch`
    // CONSUMES the stream, and that is precisely what leaves nothing for a later `clone()`.
    await request.text();

    const promise = middleware.onResponse!({
      response: new Response(null, { status: 429, headers: { "retry-after": "1" } }),
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);
    await vi.runAllTimersAsync();

    expect((await promise)?.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([payload]);
  });

  it("replays a bodied request more than once — a clone is single-use too", async () => {
    // Clone-per-attempt, not clone-once: reusing one clone across attempts fails on the second.
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      bodies.push(await (input as Request).text());
      return new Response(null, { status: 429, headers: { "retry-after": "1" } });
    });

    const payload = JSON.stringify({ name: "a project" });
    const middleware = retryMiddleware(3, 30_000);
    const request = timeoutMiddleware(30_000).onRequest!({
      request: new Request("https://example.com", { method: "POST", body: payload }),
      options: {},
      schemaPath: "",
      params: {},
    } as Parameters<NonNullable<ReturnType<typeof timeoutMiddleware>["onRequest"]>>[0]) as Request;
    await request.text(); // the first attempt, which consumes the stream

    const promise = middleware.onResponse!({
      response: new Response(null, { status: 429, headers: { "retry-after": "1" } }),
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);
    await vi.runAllTimersAsync();

    expect((await promise)?.status).toBe(429);
    expect(bodies).toEqual([payload, payload, payload]);
  });

  it("does not probe a bare 429 when retries are switched off", async () => {
    // A probe does not scale with maxRetries, but it is still capped by it: 0 means off, and a
    // probe is a retry. Missing this made `ABYSSALE_MAX_RETRIES=0` still issue one request.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(0, 30_000);

    const promise = middleware.onResponse!({
      response: new Response(null, { status: 429 }),
      request: new Request("https://example.com"),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);
    await vi.runAllTimersAsync();

    expect(await promise).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns undefined with maxRetries = 0 rather than swallowing the response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(0, 30_000);

    const result = await middleware.onResponse!({
      response: new Response(null, { status: 500 }),
      request: new Request("https://example.com"),
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);

    // `undefined` is openapi-fetch's "pass the original response through" — the caller still sees
    // the 500, it is simply never re-attempted.
    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops retrying when the caller aborted during the backoff", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const controller = new AbortController();

    const middleware = retryMiddleware(3, 30_000);
    const request = timeoutMiddleware(30_000).onRequest!({
      request: new Request("https://example.com", { signal: controller.signal }),
      options: {},
      schemaPath: "",
      params: {},
    } as Parameters<NonNullable<ReturnType<typeof timeoutMiddleware>["onRequest"]>>[0]) as Request;

    const promise = middleware.onResponse!({
      response: new Response(null, { status: 500 }),
      request,
      options: {},
    } as Parameters<NonNullable<typeof middleware.onResponse>>[0]);
    controller.abort();
    await vi.runAllTimersAsync();

    expect(await promise).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── timeoutMiddleware ─────────────────────────────────────────────────────────

describe("timeoutMiddleware", () => {
  it("attaches an AbortSignal to the request", () => {
    const middleware = timeoutMiddleware(5000);
    const request = new Request("https://example.com");

    const result = middleware.onRequest!({
      request,
      options: {},
      schemaPath: "",
      params: {},
    } as Parameters<NonNullable<typeof middleware.onRequest>>[0]);

    expect(result).toBeInstanceOf(Request);
    expect((result as Request).signal).toBeDefined();
  });
});
