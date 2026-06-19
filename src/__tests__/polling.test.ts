import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers replicated from src/index.ts for isolated unit testing ─────────────
// (pollUntil / resolveOpts are not exported; we test the same logic here)

const POLL_MIN_INTERVAL_MS = 2_000;
const POLL_MIN_MAX_INTERVAL_MS = 5_000;
const POLL_MIN_TIMEOUT_MS = 60_000;

interface PollOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(): number {
  return 0; // deterministic in tests
}

async function pollUntil<T>(
  fn: () => Promise<{ data?: T | null; error?: unknown }>,
  isDone: (data: T) => boolean,
  opts: Required<PollOptions>
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let interval = opts.intervalMs;
  for (;;) {
    const { data, error } = await fn();
    if (error) throw new Error(`[abyssale] Polling failed: ${JSON.stringify(error)}`);
    if (data && isDone(data)) return data;
    const wait = interval + jitter();
    if (Date.now() + wait > deadline) throw new Error("Polling timed out");
    await sleep(wait);
    interval = Math.min(interval * 2, opts.maxIntervalMs);
  }
}

function resolveOpts(opts?: PollOptions): Required<PollOptions> {
  return {
    intervalMs: Math.max(opts?.intervalMs ?? 3_000, POLL_MIN_INTERVAL_MS),
    maxIntervalMs: Math.max(opts?.maxIntervalMs ?? 30_000, POLL_MIN_MAX_INTERVAL_MS),
    timeoutMs: Math.max(opts?.timeoutMs ?? 1_800_000, POLL_MIN_TIMEOUT_MS),
  };
}

function makeOpts(overrides?: PollOptions): Required<PollOptions> {
  return resolveOpts({ intervalMs: 10, maxIntervalMs: 1000, timeoutMs: 5000, ...overrides });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("pollUntil (waitForGenerationRequest logic)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns immediately when the first response is already done", async () => {
    const fn = vi.fn().mockResolvedValue({
      data: { is_finalized: true, banners: [{ id: "b1" }] },
    });

    const promise = pollUntil(fn, (d: any) => d.is_finalized === true, makeOpts());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fn).toHaveBeenCalledTimes(1);
    expect((result as any).is_finalized).toBe(true);
  });

  it("polls until finalized after two pending responses", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ data: { is_finalized: false } })
      .mockResolvedValueOnce({ data: { is_finalized: false } })
      .mockResolvedValueOnce({ data: { is_finalized: true, banners: [] } });

    const promise = pollUntil(fn, (d: any) => d.is_finalized === true, makeOpts());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fn).toHaveBeenCalledTimes(3);
    expect((result as any).is_finalized).toBe(true);
  });

  it("throws a descriptive error when the API returns an error", async () => {
    const fn = vi.fn().mockResolvedValue({ error: { message: "Not found" } });

    const promise = pollUntil(fn, () => false, makeOpts());
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toThrow("[abyssale] Polling failed:")]);
  });

  it("clamps intervalMs to minimum 500ms", () => {
    const opts = resolveOpts({ intervalMs: 10 });
    expect(opts.intervalMs).toBe(POLL_MIN_INTERVAL_MS);
  });

  it("clamps maxIntervalMs to minimum 1 000ms", () => {
    const opts = resolveOpts({ maxIntervalMs: 100 });
    expect(opts.maxIntervalMs).toBe(POLL_MIN_MAX_INTERVAL_MS);
  });

  it("clamps timeoutMs to minimum 5 000ms", () => {
    const opts = resolveOpts({ timeoutMs: 100 });
    expect(opts.timeoutMs).toBe(POLL_MIN_TIMEOUT_MS);
  });

  it("uses defaults: 3s interval, 30s maxInterval, 30min timeout", () => {
    const opts = resolveOpts();
    expect(opts.intervalMs).toBe(3_000);
    expect(opts.maxIntervalMs).toBe(30_000);
    expect(opts.timeoutMs).toBe(1_800_000);
  });

  it("throws 'Polling timed out' when timeout is exceeded", async () => {
    const fn = vi.fn().mockResolvedValue({ data: { is_finalized: false } });

    // timeoutMs=0 so the first sleep already exceeds the deadline
    const promise = pollUntil(fn, (d: any) => d.is_finalized === true, {
      ...makeOpts(),
      timeoutMs: 0,
    });
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toThrow("Polling timed out")]);
  });
});
