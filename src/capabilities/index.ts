/**
 * Every capability in this build, collected by the compiler.
 *
 * ## The plugin system is the build system
 *
 * There is no runtime loader here, no registry to download from and no sandbox,
 * because this project is forked and built rather than installed. You are
 * compiling anyway, so the compiler is the plugin manager: adding a capability
 * is adding ONE FOLDER, and nothing else is edited. `import.meta.glob` resolves
 * this to a static object at build time — verified in `out/main/index.js`, which
 * carries the collected map as literal properties rather than a directory read.
 *
 * ## Why the pattern names a fixed FILE inside a folder
 *
 * `eager: true` genuinely IMPORTS everything it matches, and that was found the
 * expensive way: a probe globbing `./codex/*.ts` reported 21 tests in a file
 * containing 2, because the matched `ask.test.ts` registered its suites into the
 * running file. A pattern whose last segment is the literal `capability.ts` —
 * see the call at the foot of this file — cannot match `capability.test.ts` or
 * anything else beside it, so a capability keeps its own tests and its own
 * modules in its own folder without either reaching the bundle.
 *
 * ## Every failure here throws, and the test suite is what catches it
 *
 * A folder with no `capability` export, a manifest that fails `parseManifest`,
 * or two capabilities claiming one name all throw — from module evaluation.
 *
 * Stated precisely, because a looser version of this sentence was here and was
 * wrong: `electron-vite build` BUNDLES this module without running it, and
 * `pnpm dist` runs `build` rather than `verify`. So the gate is `pnpm test`,
 * which imports this module and therefore cannot go green over any of them. If
 * one were somehow packaged anyway, the app refuses to start rather than
 * offering her a capability it cannot perform — which is the right failure for
 * this class of fault: it is a mistake by whoever is editing the source, not a
 * file somebody dropped in a folder, and no user-facing fallback would be
 * better than saying so immediately.
 */

import { parseManifest, type CapabilityManifest } from '@shared/capability/manifest'
import type { Capability } from './kind'

export interface Collected {
  /** In folder order, which is stable across machines. See `collect`. */
  readonly manifests: readonly CapabilityManifest[]
  /**
   * The whole capability, by the name it declared.
   *
   * ONE map rather than a fast one and a slow one. Two maps put the manifest,
   * the discriminator and the handler back in separate places and made the
   * dispatch probe for a name instead of reading its `kind` — which is the
   * shape this layout exists to remove, arriving again one level down. With one
   * map the dispatch is a `switch` the compiler checks for exhaustiveness, and
   * a slow handler still cannot go down the fast path because the two branches
   * are typed differently.
   */
  readonly byName: ReadonlyMap<string, Capability>
}

function isCapability(value: unknown): value is Capability {
  if (typeof value !== 'object' || value === null) return false
  const held = value as { manifest?: unknown; kind?: unknown; handler?: unknown }
  if (typeof held.manifest !== 'object' || held.manifest === null) return false
  if (held.kind !== 'immediate' && held.kind !== 'deferred') return false
  return typeof held.handler === 'function'
}

/**
 * Turn what the glob matched into the manifests and the two dispatch tables.
 *
 * Takes the module map rather than globbing inside, so the failure paths below
 * can be stated as tests instead of as comments. The real call is at the bottom
 * of this file and is the only one that touches the filesystem's shape.
 *
 * SORTED BY PATH, so the `session.update` this produces is the same on every
 * machine. Glob key order is a property of the bundler's traversal, and an
 * unnecessary difference in what goes on the wire is an unnecessary risk.
 */
export function collect(modules: Readonly<Record<string, unknown>>): Collected {
  const manifests: CapabilityManifest[] = []
  const byName = new Map<string, Capability>()
  /** Which file claimed each name, so a collision can name both of them. */
  const claimedBy = new Map<string, string>()

  for (const path of Object.keys(modules).sort()) {
    const held = (modules[path] as { capability?: unknown } | undefined)?.capability
    if (!isCapability(held)) {
      throw new Error(
        `${path} does not export a capability. A folder under src/capabilities must export ` +
          '`capability` from `capability.ts`, with a manifest, a kind and a handler.',
      )
    }
    /**
     * PARSED, not trusted, even though it was written in TypeScript.
     *
     * The type stops a manifest existing without a handler. It does not stop a
     * name with a slash in it, a description four times longer than anybody
     * meant, or a `required` entry naming a property nothing declares — none of
     * which throw. They produce a session that configures cleanly and then
     * behaves wrongly, with nothing in any log saying which field did it.
     *
     * Here rather than only in a test. A test can be forgotten and `pnpm build`
     * does not run one; this refuses from module evaluation, so a bad manifest
     * cannot be collected at all — by the suite, and by the app itself if one
     * were somehow packaged.
     */
    const parsed = parseManifest(held.manifest)
    if (!parsed.ok) {
      throw new Error(`${path} declares an invalid manifest: ${parsed.problem.kind}`)
    }
    const name = parsed.manifest.name
    const already = claimedBy.get(name)
    if (already !== undefined) {
      // Both files named, because "duplicate capability" without them is a
      // message that sends somebody looking through every folder.
      throw new Error(`two capabilities are named ${name}: ${already} and ${path}`)
    }
    claimedBy.set(name, path)
    // The PARSED manifest, so what reaches the wire is what passed the bounds.
    manifests.push(parsed.manifest)
    byName.set(name, { ...held, manifest: parsed.manifest })
  }

  /**
   * A collection with nothing in it is a broken glob, not a decision.
   *
   * The pattern is the one thing here that can fail by matching NOTHING — a
   * moved folder, a renamed file, a bundler that resolved it differently — and
   * the result would be an app that starts cleanly, offers her no tools at all,
   * and says nothing about it. That is the silence this layout was built to
   * remove, arriving through the mechanism that removed it.
   *
   * Refused HERE rather than at the call site below, so it holds for every
   * caller rather than for the one that remembered to check.
   */
  if (manifests.length === 0) {
    throw new Error(
      'no capabilities were collected — the glob matched nothing. Either a folder is ' +
        'missing its capability.ts, or the pattern no longer resolves.',
    )
  }

  return { manifests, byName }
}

/** Everything this build can do. One folder each; nothing else is edited. */
export const CAPABILITIES: Collected = collect(
  import.meta.glob('./*/capability.ts', { eager: true }),
)
