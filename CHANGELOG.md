# Changelog

All notable changes to `@abyssale/sdk` are documented here.

## [Unreleased]

### Added
- `listWorkspaceTemplates(query?)` — `GET /workspace-templates`, with optional `category_id` / `type` filters
- `listWorkspaceTemplateCategories()` — `GET /workspace-template-categories`
- Type re-exports: `WorkspaceTemplate`, `WorkspaceTemplateCategory`, `DesignAnimation`, `AsyncElements`, `ErrorResponse`
- Regenerated types from the current OpenAPI spec:
  - `Design` now carries `project_id` / `project_name` (the old `category_id` / `category_name` are deprecated aliases)
  - Multipage print designs: `GET /designs/{designId}` returns `pages[]` + `elements_per_page` instead of `formats` / `elements` / `variables` / `dynamic_image_url`; the per-format read answers `404 format_not_found` for them
  - Printer formats expose read-only `dpi` / `bleed_size` / `safe_size`; animated designs expose `animation` (design and element level)
  - `Banner` gains `project`, `edit_url`, `view_url`, `visual_status`, `fallback_image_url`
  - Async generation bodies are typed with `AsyncElements` (AI image properties are async-only); `elements` and `template_format_name(s)` are now optional on generation bodies, matching the API
  - Sync generation accepts `original_visual_id` (visual versioning)
  - `ErrorResponse` documents the flat `errors: [{ path, code, message }]` array present on `400 invalid_payload` responses
  - `file_compression_level` documented as quality (100 = best); `webm` removed from output file types; `window` mask added

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
