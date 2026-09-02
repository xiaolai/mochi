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
     * 30s, not Vitest's 5s, and the reason is that the default bound here can
     * only ever be wrong.
     *
     * A timeout exists to catch a test that will never finish. Nothing in this
     * suite can hang for any other reason: `environment` is node, every test is
     * a pure function or a loop over a VIRTUAL clock, and there are no timers,
     * no network and no file watching anywhere in it. So a test that fails to
     * terminate is an infinite loop in production code — which a 30s bound
     * catches exactly as surely as a 5s one, twenty-five seconds later.
     *
     * What the 5s bound actually caught was the machine being busy. The rig's
     * canvas tests rasterise her a thousand times over a breath cycle, and on a
     * laptop running other work they went red in `mochi.test.ts`,
     * `silhouette-vs-icon.test.ts` and `persona.test.ts` — always
     * `Test timed out in 5000ms`, never an assertion. Measured across three
     * back-to-back runs of identical code, one of those tests took 4.9s, then
     * 49.9s, then 8.6s: the number is dominated by contention, not by the work.
     *
     * A bound with no true positives available to it and a supply of false ones
     * is a check that teaches people to disbelieve a red suite. Widened rather
     * than removed, because an infinite loop should still end the run.
     *
     * This is not licence for a slow test. The suite is ~50s for 3,452 of them;
     * anything approaching this bound on an idle machine is a defect in the
     * test, not a budget to spend.
     */
    testTimeout: 30_000,
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
