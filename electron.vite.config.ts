import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

/**
 * Path aliases, kept in step with both tsconfigs rather than with today's
 * imports. Declaring an alias in one place and not the others is how an import
 * typechecks cleanly and then fails at bundle time, so the three files change
 * together or not at all.
 */
const alias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
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
  // Root is `src/renderer`, NOT one window's folder, so every document shares a
  // dev-server origin and each builds to `out/renderer/<name>/index.html`. That
  // regularity is what lets one rule locate a window's document instead of a
  // special case per window — which matters as soon as there is a second one.
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          companion: fileURLToPath(new URL('./src/renderer/companion/index.html', import.meta.url)),
          history: fileURLToPath(new URL('./src/renderer/history/index.html', import.meta.url)),
        },
      },
    },
  },
})
