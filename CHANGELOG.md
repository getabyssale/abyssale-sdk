# Changelog

All notable changes to `@abyssale/sdk` are documented here.

## [1.1.0] — 2026-08-10

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
- Types track API version `v2026-08-10`: responses now document the top-level `version` field (`ApiVersion`); `DesignImportProblem.code` is optional (informational export warnings carry only `message`); `Banner.version` is documented as the file's integer counter, not the API version.

### Fixed
- **A failed `POST` is no longer retried.** Every `POST` in this API generates an asset, queues a
  batch or duplicates a template — all of which consume credits — and a `500`/`504` does not mean
  the work did not happen. Retrying one could bill up to four generations for a single call.
  Retries now apply to `5xx` on read requests only.
- **A bare `429` is no longer retried.** On this API `rate_limit_exceeded` is also returned for
  "not enough credits" and for plan gates, which never succeed on retry — the SDK just spent ~7s
  backing off before failing anyway. A `429` is retried only when the response carries
  `Retry-After`, and then for exactly that long.
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
  minutes. Up to 3 *consecutive* transient failures (`5xx`, a bare `429`, or a network-level throw)
  are now absorbed and retried on the normal backoff, and the streak resets on any successful poll.
  Anything else — notably `generation_request_not_found` — still fails on the first poll. The
  overall `timeoutMs` deadline is unchanged.
- **Polling helpers always raise `AbyssalePollingError`.** An empty or malformed response body
  makes the underlying fetch layer throw a raw `SyntaxError`, which escaped the helper and broke
  the documented "branch on `err.id`" contract. Timeout and empty-response failures were also
  plain `Error`s; all three are now `AbyssalePollingError` with the original on `.cause`.

### Changed (types)
- Regenerated against API `v2026-08-10`: the `errors[]` item doc records that detail relayed from
  the generation engine is translated into `{path, code, message}` before it reaches you (it used
  to arrive as `{field, message}`, contradicting the required `path`/`code`), and a printer
  format's `dpi` / `bleed_size` / `safe_size` are documented as always present.
- `ErrorResponse.id` is now **required** (`id: string`, was `id?: string`). The API guarantees it
  on every error response, and typing it optional forced callers into `err.id!` or a fallback
  branch the API never takes. Requires API `v2026-08-10` or later.

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
