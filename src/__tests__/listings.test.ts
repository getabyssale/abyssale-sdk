import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * The listings' search parameters must reach the wire in the form the API reads. A list param is
 * ONE comma-separated value (`type=static,animated`): sent repeated, the API keeps only one value.
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

function stubFetch(headers: Record<string, string> = {}) {
  const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  spy.mockReset();
  spy.mockResolvedValue(
    new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
  return spy;
}

const requestedUrl = (spy: ReturnType<typeof stubFetch>) =>
  new URL((spy.mock.calls[0][0] as Request).url);

describe("listDesigns", () => {
  it("sends no query parameter by default", async () => {
    const fetchSpy = stubFetch();
    await abyssale.listDesigns();
    const url = requestedUrl(fetchSpy);
    expect(url.pathname).toBe("/designs");
    expect(url.search).toBe("");
  });

  it("keeps a single type as one value", async () => {
    const fetchSpy = stubFetch();
    await abyssale.listDesigns({ type: "static" });
    expect(requestedUrl(fetchSpy).searchParams.getAll("type")).toEqual(["static"]);
  });

  it("sends list params as one comma-separated value", async () => {
    const fetchSpy = stubFetch();
    await abyssale.listDesigns({
      type: ["printer", "printer_multipage"],
      size: ["1080x1080", "1200x628"],
      format: ["a5", "facebook-post"],
    });
    const params = requestedUrl(fetchSpy).searchParams;
    expect(params.getAll("type")).toEqual(["printer,printer_multipage"]);
    expect(params.getAll("size")).toEqual(["1080x1080,1200x628"]);
    expect(params.getAll("format")).toEqual(["a5,facebook-post"]);
  });

  it("sends the search, date, sort and paging params as given", async () => {
    const fetchSpy = stubFetch();
    await abyssale.listDesigns({
      query: "black friday story",
      orientation: "portrait",
      updated_since: "2026-09-28",
      sort: "updated",
      order: "desc",
      page: 2,
      per_page: 25,
    });
    expect(Object.fromEntries(requestedUrl(fetchSpy).searchParams)).toEqual({
      query: "black friday story",
      orientation: "portrait",
      updated_since: "2026-09-28",
      sort: "updated",
      order: "desc",
      page: "2",
      per_page: "25",
    });
  });
});

describe("listFonts and listProjects", () => {
  it("still send nothing by default", async () => {
    let fetchSpy = stubFetch();
    await abyssale.listFonts();
    expect(requestedUrl(fetchSpy).search).toBe("");
    fetchSpy = stubFetch();
    await abyssale.listProjects();
    expect(requestedUrl(fetchSpy).search).toBe("");
  });

  it("send their filters", async () => {
    let fetchSpy = stubFetch();
    await abyssale.listFonts({ name: "Open Sans", category: "serif", weight: 700, style: "italic" });
    expect(Object.fromEntries(requestedUrl(fetchSpy).searchParams)).toEqual({
      name: "Open Sans",
      category: "serif",
      weight: "700",
      style: "italic",
    });
    fetchSpy = stubFetch();
    await abyssale.listProjects({ name: "summer", per_page: 10 });
    expect(Object.fromEntries(requestedUrl(fetchSpy).searchParams)).toEqual({ name: "summer", per_page: "10" });
  });
});

describe("totalCount", () => {
  it("reads X-Total-Count", async () => {
    stubFetch({ "X-Total-Count": "42" });
    const { response } = await abyssale.listDesigns({ per_page: 1 });
    expect(abyssale.totalCount(response)).toBe(42);
  });

  it("is undefined without the header", async () => {
    stubFetch();
    const { response } = await abyssale.listDesigns();
    expect(abyssale.totalCount(response)).toBeUndefined();
  });
});
