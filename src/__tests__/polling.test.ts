import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

/**
 * These exercise the SDK's REAL polling helpers through the public surface.
 *
 * They used to test a hand-copied `pollUntil`/`resolveOpts` pasted into this file "for isolated
 * unit testing", which meant the suite stayed green no matter what `src/index.ts` did — the copy
 * and the original had already drifted. Stub `fetch` and drive `waitForGenerationRequest`
 * instead: same coverage, against the code that ships.
 */
process.env.ABYSSALE_API_KEY ??= "test-key";
process.env.ABYSSALE_BASE_URL ??= "https://api.test.local";
// Disable the HTTP-level retries so a `fetch` call count here means "one poll". The middleware's
// own 5xx retrying is covered by middleware.test.ts; leaving it on would make every 503 below
// consume four calls and conflate the two layers.
process.env.ABYSSALE_MAX_RETRIES ??= "0";

let abyssale: typeof import("../index.js").default;
let AbyssalePollingError: typeof import("../index.js").AbyssalePollingError;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  // openapi-fetch captures `globalThis.fetch` at client creation — stub before importing.
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("../index.js");
  abyssale = mod.default;
  AbyssalePollingError = mod.AbyssalePollingError;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Poll options below every floor, so the helper's clamping is what actually applies. */
const FAST = { intervalMs: 1, maxIntervalMs: 1, timeoutMs: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("waitForGenerationRequest", () => {
  it("returns immediately when the first response is already finalized", async () => {
    fetchMock.mockImplementation(() => json({ is_finalized: true, banners: [{ id: "b1" }] }));

    const promise = abyssale.waitForGenerationRequest("req-1", FAST);
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ is_finalized: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls until finalized", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ is_finalized: false }))
      .mockResolvedValueOnce(json({ is_finalized: false }))
      .mockImplementation(() => json({ is_finalized: true, banners: [] }));

    const promise = abyssale.waitForGenerationRequest("req-2");
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ is_finalized: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("backs off exponentially from the clamped 2s floor", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ is_finalized: false }))
      .mockResolvedValueOnce(json({ is_finalized: false }))
      .mockImplementation(() => json({ is_finalized: true }));

    const promise = abyssale.waitForGenerationRequest("req-3", FAST);
    // Below the 2 000ms floor nothing has happened past the first request.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 2s floor (+ up to 500ms jitter) → second; then 4s → third.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.runAllTimersAsync();
    await promise;
  });

  it("raises AbyssalePollingError carrying the API's error id", async () => {
    fetchMock.mockImplementation(() => json({ id: "generation_request_not_found", message: "Not found" }, 404));

    const promise = abyssale.waitForGenerationRequest("missing", FAST);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AbyssalePollingError",
      id: "generation_request_not_found",
    });
    await Promise.all([vi.runAllTimersAsync(), assertion]);
  });

  it("raises AbyssalePollingError on an empty body", async () => {
    fetchMock.mockImplementation(() => new Response("", { status: 200, headers: { "content-type": "application/json" } }));

    const promise = abyssale.waitForGenerationRequest("empty", FAST);
    const assertion = expect(promise).rejects.toThrow(AbyssalePollingError);
    await Promise.all([vi.runAllTimersAsync(), assertion]);
  });

  it("throws when the request finalized with no banners at all", async () => {
    fetchMock.mockImplementation(() =>
      json({
        is_finalized: true,
        banners: [],
        errors: [{ template_format_name: "instagram-post", reason: "prompt rejected by the model" }],
      })
    );

    const promise = abyssale.waitForGenerationRequest("all-failed", FAST);
    const assertion = expect(promise).rejects.toThrow(/instagram-post: prompt rejected by the model/);
    await Promise.all([vi.runAllTimersAsync(), assertion]);
  });

  it("resolves on partial success — one format failing does not invalidate the others", async () => {
    fetchMock.mockImplementation(() =>
      json({
        is_finalized: true,
        banners: [{ id: "b1" }],
        errors: [{ template_format_name: "facebook-feed", reason: "timeout" }],
      })
    );

    const promise = abyssale.waitForGenerationRequest("partial", FAST);
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ banners: [{ id: "b1" }] });
  });

  it("rides out a couple of 503s instead of failing the whole wait", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: "internal_error" }, 503))
      .mockResolvedValueOnce(json({ id: "internal_error" }, 503))
      .mockImplementation(() => json({ is_finalized: true, banners: [{ id: "b1" }] }));

    const promise = abyssale.waitForGenerationRequest("flaky", FAST);
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ is_finalized: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up once the transient failures stop being blips", async () => {
    fetchMock.mockImplementation(() => json({ id: "internal_error" }, 503));

    const promise = abyssale.waitForGenerationRequest("down", FAST);
    const assertion = expect(promise).rejects.toMatchObject({ id: "internal_error" });
    await Promise.all([vi.runAllTimersAsync(), assertion]);
    // 3 absorbed, the 4th is fatal — well before the 60s timeout would have fired.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a 404 — a missing request will not appear later", async () => {
    fetchMock.mockImplementation(() => json({ id: "generation_request_not_found" }, 404));

    const promise = abyssale.waitForGenerationRequest("gone", FAST);
    const assertion = expect(promise).rejects.toMatchObject({ id: "generation_request_not_found" });
    await Promise.all([vi.runAllTimersAsync(), assertion]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out — the floor is 60s, not the 1ms asked for", async () => {
    fetchMock.mockImplementation(() => json({ is_finalized: false }));

    const promise = abyssale.waitForGenerationRequest("slow", FAST);
    const assertion = expect(promise).rejects.toThrow(/no result after 60s/);
    await Promise.all([vi.runAllTimersAsync(), assertion]);
  });
});

describe("waitForDuplicationRequest", () => {
  it("stops on COMPLETED", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: "IN_PROGRESS" }))
      .mockImplementation(() => json({ status: "COMPLETED", designs: [] }));

    const promise = abyssale.waitForDuplicationRequest("dup-1", FAST);
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ status: "COMPLETED" });
  });

  it("stops on ERROR — a failed duplication is a result, not an exception", async () => {
    fetchMock.mockImplementation(() => json({ status: "ERROR" }));

    const promise = abyssale.waitForDuplicationRequest("dup-2", FAST);
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ status: "ERROR" });
  });
});
