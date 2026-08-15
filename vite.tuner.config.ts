import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * The face tuner's dev server.
 *
 * Its own config, separate from the app's, because the tuner is a development
 * instrument and must never end up in a shipped bundle. It is served rather
 * than opened from disk for a concrete reason: `<script type="module">` is
 * fetched under CORS, and a `file://` origin fails that check -- so a tuner
 * split into modules simply would not run from the filesystem. Serving it also
 * buys hot reload, which is the point of a tuner.
 *
 * It imports the SAME rig modules the renderer does. That is the whole design:
 * a tuner holding its own copy of the geometry would drift from the avatar, and
 * a drifted tuner still looks authoritative -- which is worse than no tuner.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./scripts/face-tuner', import.meta.url)),
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@rig': fileURLToPath(new URL('./src/renderer/companion/rig', import.meta.url)),
    },
  },
  server: { open: true, port: 5183 },
})
