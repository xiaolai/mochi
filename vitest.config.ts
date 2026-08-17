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
    // string handling rather than a document. Anything that genuinely needs a
    // browser needs a real one, and a fake DOM would only make it look tested.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
})
