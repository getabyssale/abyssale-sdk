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

const { data, error } = await abyssale.generateImage('{designId}', {
  template_format_name: 'facebook-feed',
  elements: {
    text_title: { payload: 'Summer sale — 40% off' },
  },
});

if (error) console.error(error);
else console.log(data.file.cdn_url);
```

Every method returns `{ data, error, response }` and never throws on an HTTP error — check `error`.
The polling helpers (`waitForGenerationRequest`, `waitForDuplicationRequest`) are the exception:
they throw `AbyssalePollingError`.

## What you get

- **22 typed methods + 2 polling helpers**, generated from the OpenAPI spec —
  [every method](https://developers.abyssale.com/sdks/nodejs#every-method)
- **Webhook signature verification** from the `@abyssale/sdk/webhooks` subpath, which needs no API
  key — [signature verification](https://developers.abyssale.com/webhooks/signature-verification)
- **Narrow retries and a per-request timeout**, tuned by `ABYSSALE_MAX_RETRIES` (default `3`) and
  `ABYSSALE_TIMEOUT_MS` (default `30000`) —
  [what is retried, and what is not](https://developers.abyssale.com/sdks/nodejs#retries-and-timeouts)
- **Dual ESM and CommonJS builds** with full TypeScript types

## API compatibility

Every type in the SDK is generated from the Abyssale OpenAPI spec, so each release is pinned to the
API version it was generated against.

| SDK version | API version   |
| ----------- | ------------- |
| 1.4.0       | `v2026-09-02` |
| 1.3.0       | `v2026-08-21` |
| 1.2.0       | `v2026-08-20` |

**1.4.0 is at full parity with `v2026-09-02`**: every operation the spec publishes has a method on
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
- [API reference](https://developers.abyssale.com/api-reference/)
- [Abyssale](https://www.abyssale.com)
- [Changelog](./CHANGELOG.md)
