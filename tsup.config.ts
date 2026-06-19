import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // Bundle openapi-fetch inline so the CJS build works without ESM interop issues.
  // openapi-fetch is ESM-only; without this, require() would fail at runtime.
  noExternal: ["openapi-fetch"],
});
