import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * The three design write operations (v2026-10-21) are thin wrappers over openapi-fetch; what can
 * go wrong is the method, the path and the body reaching the wire, so that is what is asserted.
 */
process.env.ABYSSALE_API_KEY ??= "test-key";
process.env.ABYSSALE_BASE_URL ??= "https://api.test.local";

let abyssale: typeof import("../index.js").default;

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn());
  abyssale = (await import("../index.js")).default;
});

function stubFetch() {
  const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  spy.mockReset();
  spy.mockResolvedValue(
    new Response(JSON.stringify({ id: "d1", name: "Summer sale", version: "v2026-10-21" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  return spy;
}

const request = (spy: ReturnType<typeof stubFetch>) => spy.mock.calls[0][0] as Request;

describe("renameDesign", () => {
  it("PUTs the name to /designs/{id}/name", async () => {
    const spy = stubFetch();
    const { data } = await abyssale.renameDesign("d1", { name: "Summer sale" });
    const req = request(spy);
    expect(req.method).toBe("PUT");
    expect(new URL(req.url).pathname).toBe("/designs/d1/name");
    expect(await req.json()).toEqual({ name: "Summer sale" });
    expect(data?.name).toBe("Summer sale");
  });
});

describe("moveDesign", () => {
  it("PUTs the project id to /designs/{id}/project", async () => {
    const spy = stubFetch();
    await abyssale.moveDesign("d1", { project_id: "p1" });
    const req = request(spy);
    expect(req.method).toBe("PUT");
    expect(new URL(req.url).pathname).toBe("/designs/d1/project");
    expect(await req.json()).toEqual({ project_id: "p1" });
  });
});

describe("deleteDesign", () => {
  it("DELETEs /designs/{id} with no body", async () => {
    const spy = stubFetch();
    const { data } = await abyssale.deleteDesign("d1");
    const req = request(spy);
    expect(req.method).toBe("DELETE");
    expect(new URL(req.url).pathname).toBe("/designs/d1");
    expect(req.body).toBeNull();
    expect(data?.id).toBe("d1");
  });
});
