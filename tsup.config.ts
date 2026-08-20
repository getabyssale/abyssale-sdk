import { defineConfig } from "tsup";

export default defineConfig({
  // `webhooks` is a SECOND entry rather than part of the index bundle, so `@abyssale/sdk/webhooks`
  // can be imported by a receiver that holds no API key: importing `index` throws when
  // ABYSSALE_API_KEY is unset, and verifying a signature is not an API call.
  entry: ["src/index.ts", "src/webhooks.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Bundle openapi-fetch inline so the CJS build works without ESM interop issues.
  // openapi-fetch is ESM-only; without this, require() would fail at runtime.
  noExternal: ["openapi-fetch"],
});
