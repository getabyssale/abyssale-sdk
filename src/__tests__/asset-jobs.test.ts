import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

/**
 * The AI asset-job surface: three actions that start a job, the job read, the model listing, and
 * `waitForAssetJob`. The actions are thin wrappers, so what is asserted is the method, path and
 * body that reach the wire; the helper is driven through stubbed `fetch` like polling.test.ts.
 */
process.env.ABYSSALE_API_KEY ??= "test-key";
process.env.ABYSSALE_BASE_URL ??= "https://api.test.local";
// One `fetch` call per request, so call counts below mean "one poll" / "one POST" — see
// polling.test.ts for why this is assigned unconditionally.
process.env.ABYSSALE_MAX_RETRIES = "0";

let abyssale: typeof import("../index.js").default;
let AbyssalePollingError: typeof import("../index.js").AbyssalePollingError;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("../index.js");
  abyssale = mod.default;
  AbyssalePollingError = mod.AbyssalePollingError;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const request = (n = 0) => fetchMock.mock.calls[n][0] as Request;

const queued = { job_id: "job-1", status: "PENDING" };
const job = (status: string, extra: Record<string, unknown> = {}) => ({
  job_id: "job-1",
  operation: "images_remove_background",
  status,
  outputs: [],
  credits: { generation_credits: 0, ai_credits: 0 },
  error: null,
  created_at: "2026-11-09T10:00:00Z",
  finalized_at: null,
  ...extra,
});

beforeEach(() => fetchMock.mockReset());

describe("asset-job actions", () => {
  it.each([
    ["removeBackground", "/images/remove-background", { image_url: "https://e.com/a.jpg", crop: true }],
    ["textToImage", "/images/text-to-image", { prompt: "a red fox in snow", aspect_ratio: "16:9" }],
    ["upscale", "/images/upscale", { image_url: "https://e.com/a.jpg", upscale_factor: 2 }],
  ] as const)("%s POSTs its body to %s", async (method, path, body) => {
    fetchMock.mockResolvedValue(json(queued, 202));
    const { data, error } = await (abyssale[method] as (b: unknown) => Promise<{ data?: unknown; error?: unknown }>)(body);
    const req = request();
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe(path);
    expect(await req.json()).toEqual(body);
    expect(error).toBeUndefined();
    expect(data).toEqual(queued);
  });
});

describe("getAssetJob", () => {
  it("GETs /asset-jobs/{jobId}, encoding the id", async () => {
    fetchMock.mockResolvedValue(json(job("PROCESSING")));
    const { data } = await abyssale.getAssetJob("a/b");
    const req = request();
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/asset-jobs/a%2Fb");
    expect(data?.status).toBe("PROCESSING");
  });
});

describe("listAiModels", () => {
  it("sends no query without an operation and answers every action", async () => {
    fetchMock.mockResolvedValue(json({ operations: [] }));
    const { data } = await abyssale.listAiModels();
    const url = new URL(request().url);
    expect(url.pathname).toBe("/ai-models");
    expect(url.search).toBe("");
    expect(data && "operations" in data).toBe(true);
  });

  it("sends ?operation= when one is given", async () => {
    fetchMock.mockResolvedValue(
      json({ operation: "images_upscale", default_model: "topaz-precision", models: [] }),
    );
    const { data } = await abyssale.listAiModels("images_upscale");
    expect(new URL(request().url).searchParams.get("operation")).toBe("images_upscale");
    expect(data && !("operations" in data) && data.default_model).toBe("topaz-precision");
  });
});

describe("waitForAssetJob", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls until COMPLETED and returns the job", async () => {
    const output = { type: "image", url: "https://s3/out.webp", mime_type: "image/webp" };
    fetchMock
      .mockResolvedValueOnce(json(job("PENDING")))
      .mockResolvedValueOnce(json(job("PROCESSING")))
      .mockImplementation(() => json(job("COMPLETED", { outputs: [output] })));

    const promise = abyssale.waitForAssetJob("job-1");
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.status).toBe("COMPLETED");
    expect(result.outputs[0]?.url).toBe("https://s3/out.webp");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(request().url).pathname).toBe("/asset-jobs/job-1");
  });

  it("throws on FAILED, naming the job's error, with the job on the cause", async () => {
    const failed = job("FAILED", {
      error: { code: "invalid_input_asset", message: "The image was not found (HTTP 404)." },
    });
    fetchMock.mockImplementation(() => json(failed));

    const promise = abyssale.waitForAssetJob("job-1");
    const caught = promise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = (await caught) as InstanceType<typeof AbyssalePollingError>;
    expect(err).toBeInstanceOf(AbyssalePollingError);
    expect(err.message).toContain("invalid_input_asset");
    // `.id` is reserved for an API error body; the poll itself answered 200.
    expect(err.id).toBeUndefined();
    expect(((err.cause as Error).cause as { status: string }).status).toBe("FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails on the first poll when the job is not found", async () => {
    fetchMock.mockImplementation(() =>
      json({ id: "asset_job_not_found", message: "Asset job not found." }, 404),
    );

    const promise = abyssale.waitForAssetJob("missing");
    const caught = promise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = (await caught) as InstanceType<typeof AbyssalePollingError>;
    expect(err).toBeInstanceOf(AbyssalePollingError);
    expect(err.id).toBe("asset_job_not_found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
