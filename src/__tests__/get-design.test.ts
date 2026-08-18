import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * `group` layers are only returned when `i=advanced` is sent, so the flag has to reach the wire.
 * These assert the request URL, not the response shape — the point is the query parameter.
 *
 * The module reads its config at import time and throws without an API key, so the env is set
 * before the dynamic import.
 */
process.env.ABYSSALE_API_KEY ??= "test-key";
process.env.ABYSSALE_BASE_URL ??= "https://api.test.local";

let abyssale: typeof import("../index.js").default;

beforeAll(async () => {
  // openapi-fetch captures `globalThis.fetch` when the client is created, so the stub has to be
  // installed BEFORE the module is imported — spying afterwards would let a real request out.
  vi.stubGlobal("fetch", vi.fn());
  abyssale = (await import("../index.js")).default;
});

function stubFetch() {
  const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  spy.mockReset();
  spy.mockResolvedValue(
    new Response(JSON.stringify({ id: "d1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  return spy;
}

const requestedUrl = (spy: ReturnType<typeof stubFetch>) =>
  new URL((spy.mock.calls[0][0] as Request).url);



describe("getDesign", () => {
  it("sends no query parameter by default", async () => {
    const fetchSpy = stubFetch();
    await abyssale.getDesign("d1");
    const url = requestedUrl(fetchSpy);
    expect(url.pathname).toBe("/designs/d1");
    expect(url.search).toBe("");
  });

  it("sends i=advanced when advanced is requested", async () => {
    const fetchSpy = stubFetch();
    await abyssale.getDesign("d1", { advanced: true });
    expect(requestedUrl(fetchSpy).searchParams.get("i")).toBe("advanced");
  });

  it("omits the parameter when advanced is false", async () => {
    const fetchSpy = stubFetch();
    await abyssale.getDesign("d1", { advanced: false });
    expect(requestedUrl(fetchSpy).search).toBe("");
  });
});

describe("getDesignFormat", () => {
  it("needs no advanced flag — the per-format read is always the advanced view", async () => {
    const fetchSpy = stubFetch();
    await abyssale.getDesignFormat("d1", "square");
    const url = requestedUrl(fetchSpy);
    expect(url.pathname).toBe("/designs/d1/formats/square");
    expect(url.search).toBe("");
  });
});
