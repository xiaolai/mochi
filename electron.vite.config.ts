import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

/**
 * Path aliases, kept in step with the tsconfigs rather than with today's imports.
 *
 * `@rig` has no importer in `src/` right now -- only `scripts/face-tuner`, which
 * resolves it through its own `vite.tuner.config.ts`. It stays here anyway, and
 * an audit flagging it as dead is reading half the picture: `tsconfig.web.json`
 * declares the same `@rig/*` mapping and covers `src/renderer/**` as well as
 * `scripts/face-tuner/**`. Drop it here alone and the two halves disagree -- the first
 * `@rig/...` import written in the renderer would typecheck cleanly and fail at
 * bundle time, which is a worse configuration than one unused entry.
 */
const alias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@rig': fileURLToPath(new URL('./src/renderer/companion/rig', import.meta.url)),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: { input: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)) },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: { input: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)) },
    },
  },
  // Root is `src/renderer`, NOT one window's folder, so both documents share a
  // dev-server origin and both build to `out/renderer/<name>/index.html`. That
  // regularity is what lets `renderer-entry.ts` hold ONE rule for where a
  // window's document lives instead of a special case per window.
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          companion: fileURLToPath(new URL('./src/renderer/companion/index.html', import.meta.url)),
          settings: fileURLToPath(new URL('./src/renderer/settings/index.html', import.meta.url)),
        },
      },
    },
  },
})
