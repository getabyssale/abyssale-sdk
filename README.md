# @abyssale/sdk

Official Node.js / TypeScript SDK for the [Abyssale API](https://developers.abyssale.com) —
programmatic creative asset generation at scale.

**📖 Full reference: [developers.abyssale.com/sdks/nodejs](https://developers.abyssale.com/sdks/nodejs)**
— every method, configuration, error handling, retry behaviour and the polling helpers.

## Installation

```bash
npm install @abyssale/sdk
```

**Requires Node.js ≥ 20.3** — the retry middleware composes abort signals with `AbortSignal.any`,
which landed in 20.3.0.

## Quick start

Set your API key in the environment — the SDK reads it at import time and needs no constructor:

```bash
export ABYSSALE_API_KEY=your-key
```

```ts
import abyssale from '@abyssale/sdk';

const { data, error } = await abyssale.generateImage('your-design-id', {
  template_format_name: 'facebook-post',
  elements: {
    title: { payload: 'Hello World' },
  },
});

if (error) console.error(error);
else console.log(data.file.cdn_url);
```

Every method returns `{ data, error, response }` and never throws on an HTTP error — check `error`.
The polling helpers (`waitForGenerationRequest`, `waitForDuplicationRequest`) are the exception:
they throw `AbyssalePollingError`.

`ABYSSALE_TIMEOUT_MS` (default `30000`) and `ABYSSALE_MAX_RETRIES` (default `3`) tune the request
timeout and the automatic retries. Retries are deliberately narrow — reads only on `5xx`, and `429`
only when the response carries `Retry-After`. The reasoning is on the
[SDK reference](https://developers.abyssale.com/sdks/nodejs#retries-and-timeouts).

## Verifying webhook deliveries

Abyssale signs every delivery once the workspace has a signing secret, so a receiver can tell a
real delivery from anything else that finds the URL. Fetch the secret once and store it like a
password:

```ts
const { data } = await abyssale.getSigningSecret();  // mints it on the first call
```

Verify with the raw request body, from a subpath import that needs no API key:

```ts
import { verifyWebhookSignature } from '@abyssale/sdk/webhooks';

const ok = verifyWebhookSignature({
  body: rawBody,                                    // Buffer or string, exactly as received
  header: req.headers['x-abyssale-signature'],
  secret: process.env.ABYSSALE_SIGNING_SECRET!,
});
```

Four things decide whether this works:

- **Pass the raw bytes.** The signature covers what was sent; parsing the JSON and re-serializing
  it reorders keys and will never match. Use `express.raw({ type: 'application/json' })`, or
  accumulate the chunks in a bare `node:http` server.
- **It returns `false`, never throws** — on a missing, malformed, forged or stale header alike.
  Anyone who finds your URL can POST to it, and an exception in the handler is a 500.
- **A rotation puts two signatures in the header.** For 24 hours after `rotateSigningSecret()`
  every delivery carries one `v1` per valid secret, so a receiver holding either one verifies and
  you can deploy on your own schedule. The helper checks all of them.
- **Deduplicate on `X-Abyssale-Delivery-Id`**, 64 lowercase hex characters. It is present whether
  or not the delivery is signed and does not change between attempts — a delivery that exhausts
  the retry ladder arrives six times with the same id, while the signature's `t` is new each time.
  The id identifies a delivery, not an event: one event fanned out to several subscribed URLs gives
  each subscription its own id, which is all deduplication needs but is not a value two of your
  endpoints can correlate on. Use the payload's own ids for that.

Until `getSigningSecret()` is called once, deliveries are **unsigned** — fetching the secret is
what turns signing on. `rotateSigningSecret()` refuses a second rotate inside the 24-hour window
with `error.id === 'previous_secret_still_active'`, because it would drop the secret your receiver
is still using; `revokeSigningSecret()` ends the overlap deliberately.

[`examples/generate-multi-format-media-webhook.ts`](./examples/generate-multi-format-media-webhook.ts)
is a complete receiver doing all of this.

## API compatibility

Every type in the SDK is generated from the Abyssale OpenAPI spec, so each release is pinned to the
API version it was generated against.

| SDK version | API version   |
| ----------- | ------------- |
| 1.3.0       | `v2026-08-21` |
| 1.2.0       | `v2026-08-20` |

**1.3.0 is at full parity with `v2026-08-21`**: every operation the spec publishes has a method on
the client. The one deliberate exception is the design-import surface (`/designs/import/json`,
`/designs/import/json/{importId}`, `/designs/{designId}/as-import`), which is in Alpha and whose
contract may change without notice — [`scripts/fetch-spec.mjs`](./scripts/fetch-spec.mjs) strips it
before generation so a regeneration cannot re-introduce it.

Only the latest API version is served, so only the latest SDK release is supported — upgrade with the
API. Responses carry the live API version in their top-level `version` field; match the `vYYYY-MM-DD`
shape rather than pinning a literal.

## Runnable examples

See [`examples/`](./examples) — synchronous generation, async multi-format with polling, the same
with a webhook receiver, AI text-to-image and inpainting, multi-page PDF, dynamic image URLs, and
batch ZIP export.

```bash
ABYSSALE_API_KEY=your-key npx tsx examples/generate-image.ts
```

## Contributing

Architecture, conventions and the type-generation workflow are in [`AGENTS.md`](./AGENTS.md).

## Links

- [SDK reference](https://developers.abyssale.com/sdks/nodejs) — the canonical documentation
- [Developer hub](https://developers.abyssale.com)
- [API reference](https://api-reference.abyssale.com/)
- [Abyssale](https://www.abyssale.com)
- [Changelog](./CHANGELOG.md)
