import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  test: {
    // Node, not a DOM emulator. Decisions worth testing are written as pure
    // functions with their dependencies injected, so they need arithmetic and
    // string handling rather than a document. The one part that does touch a
    // canvas uses `@napi-rs/canvas`, which is a real rasteriser rather than a
    // stub — a fake DOM would only make the rig look tested.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `Path2D` is a browser global the rig imports at module scope, so it has to
    // exist before any test file is evaluated. A per-test assignment cannot do
    // it: Vitest hoists imports above the test body.
    setupFiles: ['./src/test/canvas-globals.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
})
