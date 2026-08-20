import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

/**
 * The verifier is a pure function and imports nothing from `../index.js`, so unlike every other
 * test file here it needs no API key, no fetch stub and no dynamic import. That is itself part of
 * the contract — see the "importable without a key" test at the bottom.
 */
import { verifyWebhookSignature, signatureTimestamp } from "../webhooks.js";

const SECRET = "whsec_" + "a".repeat(64);
const OTHER_SECRET = "whsec_" + "b".repeat(64);
const BODY = '{"event_type":"NEW_BANNER","banner_ids":["b1"]}';
const NOW = 1787232676;

const sign = (secret: string, t: number, body: string) =>
  createHmac("sha256", secret).update(`v1:webhook:${t}.`).update(body).digest("hex");

const header = (secret: string, t = NOW, body = BODY) => `t=${t},v1=${sign(secret, t, body)}`;

const verify = (h: string | null | undefined, secret = SECRET, body: string | Buffer = BODY) =>
  verifyWebhookSignature({ body, header: h, secret, nowSeconds: NOW });

describe("verifyWebhookSignature", () => {
  it("accepts a genuine delivery", () => {
    expect(verify(header(SECRET))).toBe(true);
  });

  it("accepts the raw body as a Buffer, which is what a node:http receiver has", () => {
    expect(verify(header(SECRET), SECRET, Buffer.from(BODY))).toBe(true);
  });

  it("rejects a body altered in transit", () => {
    expect(verify(header(SECRET), SECRET, BODY.replace("b1", "b2"))).toBe(false);
  });

  it("rejects a signature made with another workspace's secret", () => {
    expect(verify(header(OTHER_SECRET))).toBe(false);
  });

  it("rejects a delivery outside the freshness window", () => {
    expect(verify(header(SECRET, NOW - 301))).toBe(false);
  });

  it("accepts one at the edge of the window", () => {
    expect(verify(header(SECRET, NOW - 300))).toBe(true);
  });

  it("accepts a timestamp slightly in the future, for clock skew", () => {
    expect(verify(header(SECRET, NOW + 30))).toBe(true);
  });

  it("honours a custom tolerance", () => {
    const opts = { body: BODY, header: header(SECRET, NOW - 60), secret: SECRET, nowSeconds: NOW };
    expect(verifyWebhookSignature({ ...opts, toleranceSeconds: 30 })).toBe(false);
    expect(verifyWebhookSignature({ ...opts, toleranceSeconds: 120 })).toBe(true);
  });
});

describe("a receiver mid-rotation", () => {
  /**
   * For 24 hours after a rotate a delivery carries two `v1` values, one per valid secret. Both
   * halves must pass, or deploying a rotated secret would drop deliveries — the exact thing the
   * grace window exists to prevent.
   */
  const rotating = `t=${NOW},v1=${sign(SECRET, NOW, BODY)},v1=${sign(OTHER_SECRET, NOW, BODY)}`;

  it("verifies while still holding the old secret", () => {
    expect(verify(rotating, OTHER_SECRET)).toBe(true);
  });

  it("verifies once it has deployed the new one", () => {
    expect(verify(rotating, SECRET)).toBe(true);
  });

  it("checks every v1, not just the first", () => {
    // The matching hash is deliberately last: a receiver that stops at the first `v1` passes the
    // test above by luck and breaks on the first real rotation.
    expect(verify(`t=${NOW},v1=${"0".repeat(64)},v1=${sign(SECRET, NOW, BODY)}`)).toBe(true);
  });
});

describe("a malformed or hostile header is rejected, never thrown", () => {
  /**
   * Anyone who can reach the webhook URL can send any header they like. An exception in the
   * handler is a 500 and, with most frameworks, a retry storm — so every path must return false.
   */
  it.each([
    ["empty", ""],
    ["absent", null],
    ["undefined", undefined],
    ["garbage", "garbage"],
    ["no timestamp", `v1=${sign(SECRET, NOW, BODY)}`],
    ["no v1", `t=${NOW}`],
    ["empty v1", `t=${NOW},v1=`],
    ["non-numeric timestamp", "t=soon,v1=deadbeef"],
    ["exponent-notation timestamp", `t=1.787e9,v1=${sign(SECRET, NOW, BODY)}`],
    // `timingSafeEqual` throws RangeError on unequal buffer lengths, so a truncated hash must be
    // length-checked before it reaches the comparison.
    ["truncated v1", `t=${NOW},v1=dead`],
    ["over-long v1", `t=${NOW},v1=${"a".repeat(128)}`],
    // Non-ASCII bytes make the buffers differ in length once UTF-8 encoded.
    ["non-ascii v1", `t=${NOW},v1=deadébeef`],
  ])("returns false for a %s header", (_label, value) => {
    expect(() => verify(value)).not.toThrow();
    expect(verify(value)).toBe(false);
  });

  it("returns false rather than throwing when no secret has been fetched yet", () => {
    expect(verifyWebhookSignature({ body: BODY, header: header(SECRET), secret: "" })).toBe(false);
  });
});

describe("signatureTimestamp", () => {
  it("reads t from the header", () => {
    expect(signatureTimestamp(header(SECRET))).toBe(NOW);
  });

  it("is null when there is nothing usable to read", () => {
    for (const value of ["", null, undefined, "v1=abc", "t=soon"]) {
      expect(signatureTimestamp(value)).toBeNull();
    }
  });
});

describe("the module is importable without an API key", () => {
  it("does not pull in the singleton", async () => {
    // `../index.js` throws at import time without ABYSSALE_API_KEY. A receiver process that only
    // verifies deliveries must not need one, which is why this lives in its own entry point and
    // its own package export (`@abyssale/sdk/webhooks`).
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../webhooks.ts", import.meta.url), "utf8"),
    );

    // Every import must be a `node:` builtin. Anything relative would eventually reach the
    // singleton, and a bare specifier would add a runtime dependency to a receiver's install.
    const specifiers = [...source.matchAll(/^import\s.*?from\s+["'](.+?)["']/gm)].map((m) => m[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.every((s) => s.startsWith("node:"))).toBe(true);
  });
});
