import { describe, it, expect, vi, beforeEach } from "vitest";
import { retryMiddleware, timeoutMiddleware } from "../middleware.js";

// ── retryMiddleware ───────────────────────────────────────────────────────────

describe("retryMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not retry on 2xx responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const middleware = retryMiddleware(3);
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
    const middleware = retryMiddleware(3);
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

  it("retries on 429 and returns successful response", async () => {
    const successResponse = new Response(null, { status: 200 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(successResponse);

    const middleware = retryMiddleware(3);
    const response = new Response(null, { status: 429 });
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

    const middleware = retryMiddleware(2);
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
