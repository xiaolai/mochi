import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node, not a DOM emulator. Decisions worth testing are written as pure
    // functions with their dependencies injected, so they need arithmetic and
    // string handling rather than a document. The one part that does touch a
    // canvas uses `@napi-rs/canvas`, which is a real rasteriser rather than a
    // stub — a fake DOM would only make the rig look tested.
    environment: 'node',
    // Path2D is global in a browser and ships with the rasteriser under Node.
    // The rig imports it at module scope, so it has to exist before any test
    // file is evaluated — which is what a setup file is for.
    setupFiles: ['./src/test/canvas-globals.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**'],
    },
  },
})
