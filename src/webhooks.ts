/**
 * Verify the signature on an inbound Abyssale webhook delivery.
 *
 * This module is deliberately standalone: it imports nothing from `./index.js`, so a receiver
 * process that only verifies deliveries can `import { verifyWebhookSignature } from
 * "@abyssale/sdk/webhooks"` without the singleton's `ABYSSALE_API_KEY` requirement, which throws
 * at import time. Verifying is not an API call and must not need a credential that can spend
 * credits.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Purpose label bound into the signed bytes, so a webhook signature cannot be replayed
 * against another signed surface (dynamic image URLs use a different label). */
const SIGNATURE_PREFIX = "v1:webhook:";

/** Default freshness window. Generous enough for clock skew and a slow queue, short enough that a
 * captured delivery cannot be replayed indefinitely. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookSignatureOptions {
  /** The exact bytes received. See the warning below — a re-serialized object will not verify. */
  body: string | Buffer;
  /** The `X-Abyssale-Signature` header value. */
  header: string | null | undefined;
  /** The workspace's signing secret, from `GET /signing-secret`. */
  secret: string;
  /** How far the delivery's `t` may drift from now, in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  /** Current time in seconds, injected for tests. Defaults to the system clock. */
  nowSeconds?: number;
}

/**
 * `true` when the delivery was signed by Abyssale with `secret` and is inside the freshness
 * window. Never throws: every malformed, absent or hostile header is simply `false`, because
 * anyone who can reach your webhook URL can send one and an exception in your handler is a 500
 * (and, with most frameworks, a retry).
 *
 * **Pass the raw body.** Parsing JSON and re-serializing it reorders keys and changes spacing, so
 * the signature will not match. In Express use `express.raw({ type: "application/json" })`; in a
 * bare `node:http` server accumulate the chunks and keep them.
 *
 * A delivery carries **two** `v1` values for 24 hours after a rotation, one per valid secret. Only
 * one of them will match the secret you hold, which is what lets you deploy a rotated secret on
 * your own schedule — so a single non-matching `v1` never means "invalid".
 *
 * @example
 * import { verifyWebhookSignature } from "@abyssale/sdk/webhooks";
 *
 * if (!verifyWebhookSignature({ body: rawBody, header: req.headers["x-abyssale-signature"], secret })) {
 *   res.writeHead(401).end();
 *   return;
 * }
 */
export function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): boolean {
  const { body, header, secret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = options;
  if (!header || !secret) return false;

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const parts = header
    .split(",")
    .map((part) => part.split("="))
    .filter((pair): pair is [string, string] => pair.length === 2);

  const timestamp = parts.find(([key]) => key === "t")?.[1];
  // `Number` alone would accept "1e9", " 12" and "0x10"; the timestamp is plain digits.
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${SIGNATURE_PREFIX}${timestamp}.`)
    .update(body)
    .digest("hex");

  // Every `v1`, not just the first — during a rotation there are two and a receiver that checks
  // only one breaks the first time the secret is rotated.
  //
  // The length check is not an optimisation: `timingSafeEqual` THROWS `RangeError` on buffers of
  // different lengths, and `v1` is attacker-controlled, so a truncated value would take the
  // handler down rather than being rejected. Compared byte-wise on the hex text, which is
  // constant-time over the candidates that could actually match.
  return parts.some(
    ([key, value]) =>
      key === "v1" &&
      value.length === expected.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(expected)),
  );
}

/**
 * The `t` value from a signature header, in seconds, or `null` if absent or malformed.
 *
 * Exposed because `t` is the only trustworthy time in a delivery — it is covered by the
 * signature, whereas anything inside the payload was rebuilt at send time. Use it to reject stale
 * deliveries, never to order them: a retry of an older event can arrive after a newer one.
 * Deduplicate on `X-Abyssale-Delivery-Id`, which is stable across retries while `t` is not.
 */
export function signatureTimestamp(header: string | null | undefined): number | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (key === "t" && value && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}
