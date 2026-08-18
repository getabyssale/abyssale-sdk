import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

/**
 * The retry path for a request WITH a body, driven through the real client rather than by calling
 * the middleware hooks by hand.
 *
 * `middleware.test.ts` covers the same rule, but it constructs the `Request` itself and so relies
 * on this file's assumption about object identity — that openapi-fetch hands `onResponse` the very
 * `Request` object `onRequest` returned, which is what the retry state is keyed on. If that ever
 * stops holding, only a test that goes through the real pipeline notices.
 *
 * The bug being pinned: `request.clone()` was called after `fetch` had consumed the request stream,
 * so a throttled POST rejected with `TypeError: unusable` instead of returning `{data, error}` —
 * breaking the SDK's headline contract on precisely the endpoints that are rate limited.
 */
process.env.ABYSSALE_API_KEY ??= "test-key";
process.env.ABYSSALE_BASE_URL ??= "https://api.test.local";
// Unconditional, not `??=` — see the same note in polling.test.ts. `process.env` is shared across
// files in a worker, and the retry count is exactly what these assertions count.
process.env.ABYSSALE_MAX_RETRIES = "2";

let abyssale: typeof import("../index.js").default;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  abyssale = (await import("../index.js")).default;
});

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("a throttled POST", () => {
  it("returns {error}, never throws, and replays the body", async () => {
    const bodies: string[] = [];
    fetchMock.mockImplementation(async (input: Request) => {
      // `.text()`, not `.clone().text()` — a real `fetch` CONSUMES the request stream, which is the
      // whole reason a retry cannot clone it afterwards. Cloning here would hide the bug.
      bodies.push(await input.text());
      return bodies.length === 1
        ? new Response(JSON.stringify({ id: "request_rate_limited", message: "Slow down" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "1" },
          })
        : new Response(JSON.stringify({ id: "p1", name: "Summer Campaign" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    });

    const promise = abyssale.createProject({ name: "Summer Campaign" });
    await vi.runAllTimersAsync();
    const { data, error } = await promise;

    expect(error).toBeUndefined();
    expect(data).toMatchObject({ id: "p1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both attempts carried the same body — the replay is not an empty request.
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0])).toEqual({ name: "Summer Campaign" });
    expect(JSON.parse(bodies[1])).toEqual({ name: "Summer Campaign" });
  });

  it("surfaces the last error body when every attempt is refused", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "request_rate_limited", message: "Slow down" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        })
    );

    const promise = abyssale.createProject({ name: "Summer Campaign" });
    await vi.runAllTimersAsync();
    const { data, error } = await promise;

    expect(data).toBeUndefined();
    expect(error).toMatchObject({ id: "request_rate_limited" });
  });
});
