# Changelog

All notable changes to `@abyssale/sdk` are documented here.

## [Unreleased]

_Not published. The API surface this tracks is itself unreleased, so the version in
`package.json` is bumped when the release goes out, not when the change lands._

### Added

- **Webhook signature verification** — `verifyWebhookSignature` and `signatureTimestamp`, exported
  from a new `@abyssale/sdk/webhooks` subpath. It is a **separate entry point on purpose**:
  importing `@abyssale/sdk` throws without `ABYSSALE_API_KEY`, and a process that only receives
  deliveries should not have to hold a credential that can spend credits. The verifier imports
  nothing but `node:crypto`.

  Pass the **raw** body: the signature covers the bytes as sent, so a parsed-and-re-serialized
  object reorders keys and never matches. It returns `false` and never throws on a missing,
  malformed, forged or stale header — anyone who finds a webhook URL can POST to it, and an
  exception in a handler is a 500 plus, on most frameworks, a retry storm. It checks **every** `v1`
  in the header, because a rotation puts two there for 24 hours.
- **`getSigningSecret()`, `rotateSigningSecret({ force? })`, `revokeSigningSecret()`** — the three
  `/signing-secret` endpoints. Deliveries are unsigned until `getSigningSecret()` is called once;
  fetching the secret is what turns signing on. `rotateSigningSecret()` surfaces a refused second
  rotate as `error.id === 'previous_secret_still_active'` rather than throwing, in keeping with the
  rest of the client. `force` is omitted from the query string entirely when false, so an ordinary
  rotate stays a bare `POST`.
- Types regenerated to cover the three endpoints and the `SigningSecret` schema.

The API↔SDK version table below is unchanged: these endpoints are not in `v2026-08-20`, and it will
be updated by the release that publishes them.

## [1.2.0] — 2026-08-20

Types regenerated against API version `v2026-08-20`. Minor rather than patch because
`keyframes[].attr` changes type (see below) — the old type never matched what the API returns, but it
is still a compile break for anyone reading it.

**Full parity with the `v2026-08-20` OpenAPI spec**: every operation the spec publishes has a method
on the client, and every request and response type is generated from the spec rather than
hand-written. The one deliberate exception is the design-import surface (`/designs/import/json`,
`/designs/import/json/{importId}`, `/designs/{designId}/as-import`), which is in Alpha and whose
contract may change without notice — `scripts/fetch-spec.mjs` strips it before generation so a plain
regeneration cannot re-introduce it.

### Added
- `code` element type — an `animated`-only custom HTML/JS layer, read-only like `container`: it carries
  no customisable attributes, so it can never be targeted in a generation request. Added to the `type`
  union of both `DesignElement` and the per-page print element, so exhaustive `switch`es over layer
  types now have to handle it.

### Changed
- **`createDynamicImageUrl` body is now optional** — both flags default server-side, so
  `createDynamicImageUrl(designId)` type-checks. The spec marks the body optional, which made
  `operations[...]["requestBody"]` nullable; the body type is unwrapped with `NonNullable` and the
  parameter is optional on the method.
- **Animation keyframe `attr` is an object, not a string.** It is a map of property name to value —
  `{"opacity": 0}` (fade), `{"left": 1021, "top": 347}` (slide, always both), `{"scale": 120}`,
  `{"angle": -100}`, `{"volumeEffect": 0}`, `{"typewriting": 100, "textEffectType": "classic"}`.
  Values are numbers except `textEffectType`. `DesignAnimation`'s `values` map widened accordingly.
  **Breaking for anyone reading `keyframes[].attr` as a string** — but the previous type never matched
  what the API returns, so that code was already broken at runtime.
- **Per-page print attribute `value` may be an object.** `mask_properties` and `filter_properties`
  carry a nested object (e.g. `{"radius": {"tl": 1000, ...}}`) rather than a scalar; the inner keys
  vary by mask and filter and are not enumerated.
- `original_visual_id` on the **synchronous** `generateImage` is documented as **not usable**: unlike
  every other generation path, that endpoint forwards the UUID unresolved — no
  `visual_not_found` / `not_related_to_same_template` / `not_related_to_same_format` check runs and the
  outcome is undefined. Use `generateMultiFormatMedia` (async) for versioned regeneration. On the async
  paths the field is documented properly: the request must target exactly one format, or it answers
  `400 more_than_one_format`.
- `exportBanners`: a request mixing known and unknown ids **succeeds**, and the archive contains only
  the ids that were found. `404 visual_not_found` means *none* of them existed.
- `ErrorResponse.message`: when a payload has a single problem the message is that problem's own text
  prefixed with its `path` (`name: Missing data for required field.`), so `errors` need not be read to
  learn which field was rejected; it falls back to a generic sentence only when several problems
  disagree. Still prose — branch on `id`.
- Dynamic image URLs: production mode is documented as *not* unlimited — the global 10 req/s ceiling,
  workspace credits and bandwidth all still apply, and bandwidth counts cache hits.
  `enable_rate_limit` counts 5 generations per 24 h from a hash of IP + `User-Agent`, and cached
  responses do not count. A non-`static` design answers `400 template_not_static`; a design not in the
  `CREATED` status answers `400 template_not_active`.
- `Design.category_name` mirrors `project_name` on **every** read (both come from the same underlying
  row), and is `null` when the design is in no project — the previous note about the two diverging on a
  single-design read was wrong. It stays deprecated: read `project_name`.

## [1.1.0] — 2026-08-17

### Added
- `verifyApiKey()` — `POST /auth`, returns the workspace the key belongs to. Use it to test a key: the
  `/ready` health check is exempt from authentication and answers `200` even for a revoked key.
- `listWorkspaceTemplates(query?)` — `GET /workspace-templates`, with optional `category_id` / `type` filters
- `listWorkspaceTemplateCategories()` — `GET /workspace-template-categories`
- Type re-exports: `WorkspaceTemplate`, `WorkspaceTemplateCategory`, `DesignAnimation`, `AsyncElements`, `TextToImageProperties`, `ErrorResponse`
- Regenerated types from the current OpenAPI spec:
  - `Design` now carries `project_id` / `project_name` (the old `category_id` / `category_name` are deprecated aliases)
  - Multipage print designs: `GET /designs/{designId}` returns `pages[]` + `elements_per_page` instead of `formats` / `elements` / `variables` / `dynamic_image_url`; the per-format read answers `404 format_not_found` for them
  - Printer formats expose read-only `dpi` / `bleed_size` / `safe_size`; animated designs expose `animation` (design and element level)
  - `Banner` gains `project`, `edit_url`, `view_url`, `visual_status`, `fallback_image_url`
  - Async generation bodies are typed with `AsyncElements` (AI image properties are async-only); `elements` and `template_format_name(s)` are now optional on generation bodies, matching the API
  - Sync generation accepts `original_visual_id` (visual versioning)
  - `ErrorResponse` documents the flat `errors: [{ path, code, message }]` array present on `400 invalid_payload` responses
  - `file_compression_level` documented as quality (100 = best); `webm` removed from output file types; `window` mask added

- `getDesign(designId, { advanced: true })` — sends `?i=advanced`, which is what makes the API
  return `group` layers (with their `layout`, `group` block and computed `hidden` / `locked`).
  Without it the response keeps its default shape, where no `group` element appears.
  `getDesignFormat` needs no flag — the per-format read is always the advanced view.
- `AbyssalePollingError` — thrown by the polling helpers when the underlying request fails. Carries the parsed API error body on `.response`, its machine-readable code on `.id`, and the raw value on `.cause`, so callers can branch on `id` instead of parsing a message string.
- `examples/text-to-image-inpainting.ts` — AI image generation and inpainting on
  `generateMultiFormatMedia`. Async-only: the synchronous `generateImage` answers
  `400 invalid_payload` for `text_to_image`.
- `npm run typecheck` — `tsc --noEmit` over `src`, plus a pass over `examples/` resolving
  `@abyssale/sdk` to `src/index.ts`. The examples were previously never compiled by any script, so
  they could silently rot against a regenerated `src/generated.ts`. Runs in `prepublishOnly`.
- Types track API version `v2026-08-17`: responses now document the top-level `version` field (`ApiVersion`); `DesignImportProblem.code` is optional (informational export warnings carry only `message`); `Banner.version` is documented as the file's integer counter, not the API version.

### Fixed
- **A failed `POST` is no longer retried.** Every `POST` in this API generates an asset, queues a
  batch or duplicates a template — all of which consume credits — and a `500`/`504` does not mean
  the work did not happen. Retrying one could bill up to four generations for a single call.
  Retries now apply to `5xx` on read requests only.
- **A bare `429` is probed once instead of being retried three times or not at all.** Three
  unrelated refusals answer `429` and two of them share an id, so neither extreme was right. A
  `429` carrying `Retry-After` is a genuine endpoint throttle (`request_rate_limited`) and gets
  the full ladder, waiting exactly as long as it was told. Without that header the SDK cannot
  tell a spent credit balance from the gateway's global 10 req/s ceiling — both answer
  `rate_limit_exceeded`, and the ceiling is enforced a layer above the API, so it carries neither
  the header nor reliably the error envelope. Retrying all of them burned ~7s on refusals that
  never clear; retrying none of them failed a burst of parallel generation calls outright, and
  generation endpoints are in no tier, so the ceiling is the only limit they can hit. So a bare
  `429` now gets exactly **one** retry after a fixed second — one second is what the per-second
  ceiling needs, and being wrong costs a second on a call that was failing anyway. A bare `429`
  identified as `feature_not_in_plan` is unambiguous and is not retried at all.
  `ABYSSALE_MAX_RETRIES=0` disables the probe along with everything else.
- **A retry no longer inherits the first attempt's timeout.** `AbortSignal.timeout` starts counting
  when it is created, and retries reused the signal built for the original request — so one
  `ABYSSALE_TIMEOUT_MS` window covered every attempt *plus* the backoff sleeps between them. Three
  retries behind a 27s `Retry-After` aborted mid-retry despite the default 30s timeout. Each attempt
  now gets its own window, measured from its own dispatch, and a caller who aborts during a backoff
  is no longer charged another attempt. `retryMiddleware` takes `timeoutMs` as a second argument.
- **A generation where every format failed is no longer reported as a success.**
  `waitForGenerationRequest` resolved on `is_finalized: true` alone, so a request that produced no
  output at all resolved with `banners: []` and the reasons sitting unread in `errors[]` — callers
  iterating `result.banners` printed nothing and saw no failure. It now throws
  `AbyssalePollingError` when a finalized request has no banners *and* at least one error, with the
  failed `template_format_name`/`reason` pairs in the message and the status object on
  `err.cause.cause`. Partial success is unchanged: one format failing still resolves, so check
  `result.errors` when you need every requested format. This matters more now that image elements
  accept `text_to_image` — a model can reject a prompt where a plain render would not have failed.
- **A single transient failure no longer destroys a long poll.** The loop threw on the first error
  of any kind, so one `503` or one aborted poll ended a wait that may already have run for 25
  minutes. Up to 3 *consecutive* transient failures are now absorbed and retried on the normal
  backoff, and the streak resets on any successful poll. A failure counts as transient on exactly
  the same rule the retry middleware applies — a `5xx`, a network-level throw, or a `429` that
  carries `Retry-After` (and then the poll waits for that long instead of its own interval).
  Anything else fails on the first poll: `404 generation_request_not_found`, and a **bare `429`**,
  which on this API means out of credits or a plan gate and never improves by waiting. The overall
  `timeoutMs` deadline is unchanged.
- **Polling helpers always raise `AbyssalePollingError`.** An empty or malformed response body
  makes the underlying fetch layer throw a raw `SyntaxError`, which escaped the helper and broke
  the documented "branch on `err.id`" contract. Timeout and empty-response failures were also
  plain `Error`s; all three are now `AbyssalePollingError` with the original on `.cause`.

### Changed (types)
- Regenerated against API `v2026-08-17`: the `errors[]` item doc records that detail relayed from
  the generation engine is translated into `{path, code, message}` before it reaches you (it used
  to arrive as `{field, message}`, contradicting the required `path`/`code`), and a printer
  format's `dpi` / `bleed_size` / `safe_size` are documented as always present.
- `ErrorResponse.id` is now **required** (`id: string`, was `id?: string`). The API guarantees it
  on every error response, and typing it optional forced callers into `err.id!` or a fallback
  branch the API never takes. Requires API `v2026-08-17` or later.

### Removed
- **`index.js`** — a hand-written CommonJS client from the repo's first commit, superseded by
  `src/index.ts` and unreferenced since (it was not even published: `files` ships `dist/` only).
  Its `generateAsset` was an older name for `generateImage`.

### Changed
- `npm run generate` now strips the Alpha design-import surface itself, via `scripts/fetch-spec.mjs`. It previously pulled the unstripped public spec, so a plain regeneration silently re-added every `DesignImport*` path and schema — and `prepublishOnly` runs `generate`, so it would have shipped. The script fails loudly on a dangling `$ref` rather than emitting types that only break at compile time. Point it at an unpublished spec with `ABYSSALE_SPEC_URL=/path/to/api.yaml`. It strips the
  as-import path under both parameter spellings (`{designUuid}`, published, and `{designId}`,
  the pending rename) so it works against either source.

### Excluded
- The design-import surface (`POST /designs/import/json`, `GET`/`PUT` `/designs/import/json/{importId}`, `GET /designs/{designId}/as-import`) is **not** in the SDK — the API is in Alpha and its contract may change without notice.

## [1.0.0] — 2025-06-17

### Added
- Initial release of the official Abyssale Node.js / TypeScript SDK
- 17 typed methods covering the full Abyssale REST API surface:
  - Designs: `listDesigns`, `getDesign`, `getDesignFormat`
  - Asset generation: `generateImage`, `generateMultiFormatMedia`, `generateMultiPagePdf`, `getGenerationRequest`
  - Polling helpers: `waitForGenerationRequest`, `waitForDuplicationRequest`
  - Files: `getFile`
  - Fonts: `listFonts`
  - Projects: `listProjects`, `createProject`
  - Exports: `exportBanners`
  - Dynamic images: `createDynamicImageUrl`
  - Workspace templates: `duplicateWorkspaceTemplate`, `getDuplicationRequest`
- TypeScript types auto-generated from the public Abyssale API spec via `openapi-typescript`
- Dual ESM + CJS output for maximum compatibility
- Zero-config singleton pattern — configure via `ABYSSALE_API_KEY` environment variable
- Automatic retry with exponential backoff on `429` and `5xx` responses (3 retries, hardcoded)
- Request timeout: 30 s (hardcoded)
- Built-in polling helpers with exponential backoff, jitter, and configurable timeout (default 30 min)
- Full public type exports: `Banner`, `Design`, `DesignFormat`, `Font`, `ProjectSummary`, `PollOptions`, and more
