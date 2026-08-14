# Abyssale Node.js SDK

## What this is
Official Node.js / TypeScript SDK for the Abyssale API.
Types are auto-generated from the public OpenAPI spec at `https://api-reference.abyssale.com/api.yaml`.

## Architecture

```
src/generated.ts       ← auto-generated types (openapi-typescript) — never edit manually
src/middleware.ts      ← retry (idempotent 5xx + Retry-After 429 only) + timeout middleware
src/index.ts           ← singleton export: 18 named methods + 2 polling helpers + public type re-exports
dist/                  ← compiled output, committed and kept current — built by tsup
scripts/fetch-spec.mjs ← fetches the spec and strips the Alpha design-import surface
```

## Where the docs live

The **canonical SDK reference is the docs site**: `https://developers.abyssale.com/sdks/nodejs`
(source: `abyssale-developers-doc/docs/sdks/nodejs.md`). `README.md` is deliberately a short
pointer — do not re-expand the method list, config table or retry rules into it, or the two copies
will drift. Add new facts to the docs page; keep `llms.txt` in sync since it is machine-facing.

## Key decisions

- **Singleton pattern** — `import abyssale from '@abyssale/sdk'` gives a ready-to-use object. No `new`, no constructor.
- **Config via env vars only** — `ABYSSALE_API_KEY` (required). `ABYSSALE_TIMEOUT_MS` (default 30 000) and `ABYSSALE_MAX_RETRIES` (default 3) are optional. `ABYSSALE_BASE_URL` is an undocumented escape hatch for local URL overrides.
- **Production-only** — base URL is always `https://api.abyssale.com`. Override locally via `ABYSSALE_BASE_URL`.
- **openapi-fetch returns `{ data, error }`** — methods never throw on HTTP errors. Always check `error`.
- **openapi-fetch is bundled inline** (`noExternal: ['openapi-fetch']` in tsup) because it is ESM-only and would break CJS consumers otherwise.

## Common commands

```bash
npm run generate    # regenerate src/generated.ts from the public OpenAPI spec
npm run build       # compile to dist/ (ESM + CJS + .d.ts)
npm run dev         # watch mode — rebuilds dist/ on every src/ save
npm test            # vitest
```

## Adding a new API endpoint

1. Update the OpenAPI spec at `https://api-reference.abyssale.com/api.yaml`
2. Run `npm run generate` — pulls the latest spec and regenerates `src/generated.ts`
3. Add a method to the `abyssale` object in `src/index.ts` following the existing pattern
4. Add a JSDoc `@example` to the method

**Deliberate exclusion — design import.** The design-import surface (`POST /designs/import/json`,
`GET`/`PUT` `/designs/import/json/{importId}`, `GET /designs/{designId}/as-import` and every
`DesignImport*` / `DesignAsImportResponse` schema) is in **Alpha** and intentionally NOT in the
SDK. **`npm run generate` strips them automatically** — `scripts/fetch-spec.mjs` fetches the spec,
removes those paths, every `DesignImport*` / `DesignAsImportResponse` schema and the matching
`components.responses` entries, then fails loudly if the strip left a dangling `$ref`. No manual
step, and `prepublishOnly` can no longer ship the Alpha surface by accident.

`ApiVersion` is deliberately NOT stripped — it is shared with `Design`, `Banner` and
`ErrorResponse`. To regenerate against an unpublished spec (e.g. an `abyssale-edge-api` branch),
set `ABYSSALE_SPEC_URL` to a local path. Delete the script once the design-import API is stable.

## Local development in another repo

```bash
# SDK repo — one-time setup
npm run build && npm link

# Consumer repo — one-time setup
npm link @abyssale/sdk

# SDK repo — during development
npm run dev   # tsup watches src/ and rebuilds on save
```

## Publishing

`npm publish` triggers `prepublishOnly`: generates types → builds → runs tests → publishes.
The tarball contains only `dist/` and `README.md` (controlled by `"files"` in package.json).

## Tests

Tests live in `src/__tests__/`. Run with `npm test`.
Covers middleware (retry + timeout) and polling helpers (`waitForGenerationRequest`). Use vitest + `vi.spyOn(globalThis, 'fetch')` to mock HTTP.
