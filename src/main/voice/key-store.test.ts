import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The key must not be reachable from the renderer, and that has to be a TEST.
 *
 * `safeStorage` needs a running Electron, so the encryption itself is not
 * exercised here. What is exercised is the property that actually protects the
 * secret: which code can reach it. That property is architectural, it is
 * checkable from the source tree, and it is exactly the kind of thing that
 * erodes — someone adds a convenient getter, the settings window starts
 * displaying the key to "confirm it saved", and nothing fails.
 *
 * The window that would receive it is the same one that loads a face out of a
 * user-writable folder. That is why the boundary is worth a test rather than a
 * comment.
 */
const SRC = fileURLToPath(new URL('../..', import.meta.url))

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('the stored key stays in main', () => {
  it('is unreachable from the renderer and the preload', () => {
    // A bridge method returning it, or a renderer importing the store, is the
    // whole failure. Neither is possible if the module cannot be imported
    // there.
    const exposed: string[] = []
    for (const area of ['renderer', 'preload']) {
      for (const file of filesUnder(join(SRC, area))) {
        const text = readFileSync(file, 'utf8')
        if (/from\s+['"].*key-store['"]/.test(text) || /\breadApiKey\b/.test(text)) {
          exposed.push(file.slice(SRC.length))
        }
      }
    }
    expect(exposed, exposed.join('\n')).toEqual([])
  })

  it('is read by exactly the two places that need the key ITSELF', () => {
    // Everything else asks `apiKeyState`, which returns only whether one is
    // stored and its last four characters. These two need the actual bytes:
    //
    //   main/index.ts             the broker's credential callback, which puts
    //                             it in an Authorization header
    //   main/settings/channels.ts the Check button, which hands it to
    //                             `verifyApiKey` to ask OpenAI about it
    //
    // A third caller is worth noticing, which is the whole point of pinning the
    // list rather than counting it. The stronger rule -- that neither the
    // renderer nor the preload can reach this module at all -- is the test
    // above; this one is about how wide the surface is inside main.
    const callers: string[] = []
    for (const file of filesUnder(SRC)) {
      if (file.endsWith('key-store.ts') || file.endsWith('.test.ts')) continue
      if (/\breadApiKey\b/.test(readFileSync(file, 'utf8'))) callers.push(file.slice(SRC.length))
    }
    expect(callers.sort()).toEqual(['main/index.ts', 'main/settings/channels.ts'])
  })
})

describe('what the settings window is told about it', () => {
  it('is whether one is set, its last four, and nothing more', () => {
    // Read off the IPC contract rather than off a running app: if somebody adds
    // `key: string` to this shape, the secret starts crossing the bridge and
    // every other check in this file still passes.
    const contract = readFileSync(join(SRC, 'shared/ipc.ts'), 'utf8')
    const auth = /readonly auth: \{([\s\S]*?)\n  \}/.exec(contract)
    expect(auth, 'the auth field is no longer where this test looks').not.toBeNull()

    const fields = [...(auth![1] ?? '').matchAll(/readonly (\w+):/g)].map((m) => m[1] ?? '')
    const alphabetical = (a: string, b: string): number => a.localeCompare(b)
    expect([...fields].sort(alphabetical)).toEqual(
      ['canStoreKey', 'keyHint', 'keySet', 'source'].sort(alphabetical),
    )
  })

  it('sends no field whose name suggests a secret', () => {
    // A blunt check on purpose. `keyHint` is allowed by name above; anything
    // called `key`, `token`, `bearer` or `secret` is not.
    const contract = readFileSync(join(SRC, 'shared/ipc.ts'), 'utf8')
    const snapshot = /export interface SettingsSnapshot \{([\s\S]*?)\n\}/.exec(contract)
    const body = snapshot?.[1] ?? ''
    for (const banned of [/readonly key:/, /readonly token:/, /readonly bearer:/, /secret/i]) {
      expect(banned.test(body), `SettingsSnapshot matches ${String(banned)}`).toBe(false)
    }
  })
})
