# Changelog

All notable changes to `@abyssale/sdk` are documented here.

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
