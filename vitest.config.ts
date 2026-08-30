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
    /*
      SUSPENDED FOR THE REDESIGN, and reported rather than hidden.

      These four hold v1's presentation conventions — its class vocabulary, its
      token set, its id list, its call sites. Every one of them was doing its
      job, which is the problem: they hold the shape of the window being
      replaced, so a rebuild fails them by succeeding.

      `dev-docs/suspended-for-redesign.md` is the manifest, and
      `redesign-suspended.test.ts` reads BOTH this list and that file, so the two
      cannot drift and every run prints what is off. An exclusion nobody is
      reminded of is an exclusion that becomes permanent.

      Nothing about correctness is here. The pure rules, main, the store, the
      capability layer and the pronoun discipline all still run.
    */
    exclude: [
      'src/renderer/stylesheets.test.ts',
      'src/renderer/design-values.test.ts',
      'src/renderer/documents.test.ts',
      'src/renderer/rules/wiring.test.ts',
    ],
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
