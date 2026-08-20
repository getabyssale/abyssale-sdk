import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * `force` is the only query parameter on this surface and it exists to override a `409`, so what
 * matters is that it reaches the wire when asked for and is ABSENT otherwise — sending
 * `force=false` would read as an explicit override in a server log.
 *
 * The module reads its config at import time and throws without an API key, so the env is set
 * before the dynamic import.
 */
process.env.ABYSSALE_API_KEY ??= "test-key";
process.env.ABYSSALE_BASE_URL ??= "https://api.test.local";

let abyssale: typeof import("../index.js").default;

beforeAll(async () => {
  // openapi-fetch captures `globalThis.fetch` when the client is created, so the stub has to be
  // installed BEFORE the module is imported.
  vi.stubGlobal("fetch", vi.fn());
  abyssale = (await import("../index.js")).default;
});

function stubFetch(status = 200, body: unknown = { secret: "whsec_x", created_at_ts: 1 }) {
  const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  spy.mockReset();
  spy.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  return spy;
}

const requested = (spy: ReturnType<typeof stubFetch>) => {
  const request = spy.mock.calls[0][0] as Request;
  return { url: new URL(request.url), method: request.method };
};

describe("getSigningSecret", () => {
  it("reads the secret with a bare GET", async () => {
    const fetchSpy = stubFetch();
    await abyssale.getSigningSecret();
    const { url, method } = requested(fetchSpy);
    expect(method).toBe("GET");
    expect(url.pathname).toBe("/signing-secret");
    expect(url.search).toBe("");
  });
});

describe("rotateSigningSecret", () => {
  it("sends no query parameter by default", async () => {
    const fetchSpy = stubFetch();
    await abyssale.rotateSigningSecret();
    const { url, method } = requested(fetchSpy);
    expect(method).toBe("POST");
    expect(url.pathname).toBe("/signing-secret/rotate");
    expect(url.search).toBe("");
  });

  it("sends force=true when the caller overrides the refusal", async () => {
    const fetchSpy = stubFetch();
    await abyssale.rotateSigningSecret({ force: true });
    expect(requested(fetchSpy).url.searchParams.get("force")).toBe("true");
  });

  it("omits the parameter when force is false", async () => {
    const fetchSpy = stubFetch();
    await abyssale.rotateSigningSecret({ force: false });
    expect(requested(fetchSpy).url.search).toBe("");
  });

  it("surfaces a refused second rotate as error.id, not a throw", async () => {
    // A double rotate inside the 24-hour window answers 409 `previous_secret_still_active`.
    // Callers branch on `error.id`, so the envelope has to arrive intact.
    stubFetch(409, {
      id: "previous_secret_still_active",
      message: "A previous signing secret is still valid.",
    });

    const { data, error } = await abyssale.rotateSigningSecret();

    expect(data).toBeUndefined();
    expect(error?.id).toBe("previous_secret_still_active");
  });
});

describe("revokeSigningSecret", () => {
  it("posts with no body and no query", async () => {
    const fetchSpy = stubFetch();
    await abyssale.revokeSigningSecret();
    const { url, method } = requested(fetchSpy);
    expect(method).toBe("POST");
    expect(url.pathname).toBe("/signing-secret/revoke");
    expect(url.search).toBe("");
  });
});
