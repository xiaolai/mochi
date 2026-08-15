import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@rig': fileURLToPath(new URL('./src/renderer/companion/rig', import.meta.url)),
    },
  },
  test: {
    // Node, not jsdom. The geometry modules are deliberately canvas-free so
    // they can be tested as arithmetic; the one module that does touch a canvas
    // uses @napi-rs/canvas, which is a real rasteriser rather than a stub.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/canvas-globals.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/shared/avatar.ts'],
    },
  },
})
