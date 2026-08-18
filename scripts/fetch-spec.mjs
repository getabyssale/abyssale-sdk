#!/usr/bin/env node
/**
 * Fetch the public OpenAPI spec and strip the Alpha design-import surface before
 * `openapi-typescript` sees it.
 *
 * Why this exists: `npm run generate` used to point straight at the published spec, so a plain
 * regeneration silently re-introduced every `DesignImport*` path and schema into
 * `src/generated.ts` — and `prepublishOnly` runs `generate`, so it would have shipped. The
 * exclusion is deliberate (see AGENTS.md): the design-import API is in Alpha and its contract may
 * change without notice. Stripping it here makes the exclusion reproducible instead of a manual
 * step someone has to remember.
 *
 * Delete this script (and the `EXCLUDED_*` lists) once the design-import API is declared stable.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import yaml from 'js-yaml'

// `ABYSSALE_SPEC_URL` may be an http(s) URL or a local path — the latter is how you regenerate
// against an unpublished spec (e.g. a branch of abyssale-edge-api) before it goes live.
const SPEC_URL = process.env.ABYSSALE_SPEC_URL ?? 'https://api-reference.abyssale.com/api.yaml'
const OUT = process.argv[2] ?? 'spec.stripped.json'

/**
 * Paths removed wholesale. The as-import path used to be listed under both parameter spellings
 * while `{designUuid}` → `{designId}` was still unpublished; v2026-08-17 shipped the rename, so
 * the published spec and the edge repo agree and only `{designId}` remains.
 */
const EXCLUDED_PATHS = [
  '/designs/import/json',
  '/designs/import/json/{importId}',
  '/designs/{designId}/as-import',
]

/**
 * Schemas removed wholesale. Prefix-matched, plus the exact names that do not share the prefix.
 * NOTE: `ApiVersion` is deliberately NOT excluded — it is shared with `Design`, `Banner` and
 * `ErrorResponse`, which stay in the SDK.
 */
const EXCLUDED_SCHEMA_PREFIXES = ['DesignImport']
const EXCLUDED_SCHEMA_NAMES = ['DesignAsImportResponse']

const isExcludedSchema = (name) =>
  EXCLUDED_SCHEMA_NAMES.includes(name) || EXCLUDED_SCHEMA_PREFIXES.some((p) => name.startsWith(p))

async function readSpec(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.status} ${res.statusText}`)
    return res.text()
  }
  return readFileSync(source.replace(/^file:\/\//, ''), 'utf8')
}

const spec = yaml.load(await readSpec(SPEC_URL))

const droppedPaths = []
for (const p of EXCLUDED_PATHS) {
  if (spec.paths?.[p]) {
    delete spec.paths[p]
    droppedPaths.push(p)
  }
}

const droppedSchemas = []
const schemas = spec.components?.schemas ?? {}
for (const name of Object.keys(schemas)) {
  if (isExcludedSchema(name)) {
    delete schemas[name]
    droppedSchemas.push(name)
  }
}

// Shared `components.responses` entries follow the same naming and are referenced only by the
// excluded paths — but they are not under `paths`, so deleting the paths leaves them behind
// pointing at schemas that are now gone.
const droppedResponses = []
const responses = spec.components?.responses ?? {}
for (const name of Object.keys(responses)) {
  if (isExcludedSchema(name)) {
    delete responses[name]
    droppedResponses.push(name)
  }
}

// A dangling $ref would make the generated types reference a schema that no longer exists, so
// fail loudly rather than emitting something that only breaks at `tsc` time.
const dangling = new Set()
const walk = (node) => {
  if (Array.isArray(node)) return node.forEach(walk)
  if (!node || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/')) {
      const target = v.slice('#/components/schemas/'.length)
      if (!(target in schemas)) dangling.add(target)
    } else walk(v)
  }
}
walk(spec)
if (dangling.size) {
  throw new Error(
    `Stripping left dangling $refs to: ${[...dangling].join(', ')}.\n` +
      `Either those schemas are still referenced by a kept path, or the exclusion lists in ` +
      `scripts/fetch-spec.mjs need updating.`,
  )
}

writeFileSync(OUT, JSON.stringify(spec, null, 2))
console.log(
  `Wrote ${OUT} — stripped ${droppedPaths.length} path(s), ${droppedSchemas.length} schema(s) ` +
    `and ${droppedResponses.length} shared response(s).`,
)
