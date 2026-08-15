/**
 * The one secret this app stores, and the only file that touches it.
 *
 * ## Encrypted by the OS, or not stored at all
 *
 * `safeStorage` is Keychain on macOS and DPAPI on Windows: the ciphertext is
 * bound to the user account, so a copy of the file on another machine is
 * useless.
 *
 * Linux needs a second question, and this file originally failed to ask it.
 * `isEncryptionAvailable()` returns TRUE there for the `basic_text` backend,
 * which Electron documents as encrypting with a hardcoded password — anyone
 * holding the file and the published constant can read it. See
 * `canStoreSecrets`, which is the predicate every path here now uses.
 *
 * That case REFUSES rather than falling back to plaintext. A key written in the
 * clear to a JSON file in a home directory is the outcome the encryption exists
 * to prevent, and doing it silently — with the settings window reporting
 * success — is worse than not offering the feature on that machine. The user is
 * told, and `codex login --with-api-key` still works.
 *
 * ## Everything is synchronous, on purpose
 *
 * `safeStorage.encryptString` and `decryptString` have no asynchronous form in
 * Electron — the Keychain/DPAPI call is synchronous by API, so it cannot be
 * moved off the main thread whatever the surrounding I/O does. Wrapping a
 * sync crypto call in async file I/O would add a state machine and move
 * nothing measurable: the payload is well under a kilobyte, and the read
 * happens at most once per session thanks to the hint cache below.
 *
 * ## What leaves this module
 *
 * The key goes to exactly two callers, both in main: `credential.ts`, which
 * puts it in an Authorization header, and `verify.ts`, which asks OpenAI
 * whether it works. It is never returned to the renderer, never logged, never
 * included in an error message, and never written to a preferences file. The
 * settings window learns only whether one is set and its last four characters.
 */

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import { keyHint, type KeyStoreProblem } from '@shared/auth'

/** Its own file, not a field in `preferences.json`. See the header. */
const KEY_FILE = 'openai-key.enc'

/**
 * A ceiling on what is read back.
 *
 * The ciphertext of a 400-character key is a few hundred bytes. This file lives
 * in a user-writable directory, so its size is not this module's to assume —
 * without a bound, a file swapped for a large one is read whole into main's
 * heap before `decryptString` gets to reject it.
 */
const MAX_FILE_BYTES = 64 * 1024

function keyPath(userData: string): string {
  return join(userData, KEY_FILE)
}

export type StoreResult =
  { readonly ok: true } | { readonly ok: false; readonly why: KeyStoreProblem }

/**
 * The last four characters, remembered so the key need not be.
 *
 * `apiKeyState` is called for every settings snapshot, and each call used to
 * decrypt the whole credential to compute four characters — pulling the
 * plaintext into main's heap, repeatedly, for something that cannot change
 * without going through this module. Keyed by path so two user-data
 * directories in one test run cannot see each other's answer.
 */
const hints = new Map<string, string | null>()

/**
 * Encrypt and write, or say why not.
 *
 * No validation of the key's SHAPE here — `apiKeyProblem` owns that and runs
 * before this is reached. This module's single responsibility is that whatever
 * it is handed is encrypted at rest or not written.
 */
export function storeApiKey(userData: string, key: string): StoreResult {
  // The SAME predicate the pane asked, not a second, weaker one. Two different
  // notions of "can this machine keep a secret" is how the window offers a
  // field that writes something it should have refused.
  if (!canStoreSecrets()) return { ok: false, why: 'no-keychain' }

  const path = keyPath(userData)
  // Written beside the target and renamed over it. A direct write truncates the
  // live file first, so a crash, a full disk or a partial write between those
  // two moments leaves no key at all -- the previous WORKING credential
  // destroyed by an attempt to replace it. `rename` within a directory is
  // atomic, so the file is either the old ciphertext or the new one.
  const temporary = `${path}.new`
  try {
    mkdirSync(dirname(path), { recursive: true })
    // 0o600 as well as encryption. Belt and braces: the ciphertext is useless
    // to another account, and it is also unreadable by one.
    writeFileSync(temporary, safeStorage.encryptString(key.trim()), { mode: 0o600 })
    renameSync(temporary, path)
    // `mode` applies only when a file is CREATED. An existing file keeps the
    // permissions it had, so a credential file left group-readable by an older
    // build stays that way through every later save unless this runs.
    chmodSync(path, 0o600)
    hints.set(path, keyHint(key))
    return { ok: true }
  } catch (error: unknown) {
    // LOGGED here, not returned. The key is not in a write error, but the
    // absolute path is -- and the returned value reaches the settings window,
    // so carrying it puts a home directory on screen and into any screenshot
    // of it. The user cannot act on the path; whoever reads the log can.
    console.error('[auth] the key could not be written:', error)
    rmSync(temporary, { force: true })
    return { ok: false, why: 'write-failed' }
  }
}

/**
 * The key, for the two callers that need it.
 *
 * Returns null for every failure rather than throwing: a missing keychain, a
 * file written by another user account, a truncated file. The caller's next
 * step is identical in all of them — fall back to reporting no credential — and
 * a throw here would take down a session open.
 */
export function readApiKey(userData: string): string | null {
  if (!canStoreSecrets()) return null
  const path = keyPath(userData)

  let raw: Buffer
  try {
    // No `existsSync` guard. It was a second syscall answering a question this
    // read answers anyway, and the gap between the two is a race: a file
    // removed in between came back as "decryption failed", which is a
    // different problem with different advice.
    const stats = statSync(path)
    if (!stats.isFile()) {
      console.error('[auth] the credential path is not a regular file; treating it as absent')
      return null
    }
    if (stats.size > MAX_FILE_BYTES) {
      console.error(
        `[auth] the credential file is ${String(stats.size)} bytes; refusing to read it`,
      )
      return null
    }
    raw = readFileSync(path)
  } catch (error: unknown) {
    // Absent is the ordinary case -- no key has been stored -- and says
    // nothing. Anything else is a real I/O problem, and saying "could not be
    // decrypted" for a permission error sends somebody to look at the wrong
    // thing entirely.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[auth] the credential file could not be read:', error)
    }
    return null
  }

  try {
    const decrypted = safeStorage.decryptString(raw)
    return decrypted === '' ? null : decrypted
  } catch {
    // Deliberately no detail. Anything derived from a failed decryption is
    // derived from the ciphertext, and this is the one place where a helpful
    // log line is a bad idea.
    console.error('[auth] the stored key could not be decrypted; treating it as absent')
    return null
  }
}

/** Whether one is set, and its last four. Never the key. */
export function apiKeyState(userData: string): { readonly set: boolean; readonly hint: string } {
  const path = keyPath(userData)
  const cached = hints.get(path)
  if (cached !== undefined)
    return cached === null ? { set: false, hint: '' } : { set: true, hint: cached }

  const key = readApiKey(userData)
  const hint = key === null ? null : keyHint(key)
  hints.set(path, hint)
  return hint === null ? { set: false, hint: '' } : { set: true, hint }
}

/**
 * Remove it. Idempotent, so "clear" is safe to press twice.
 *
 * Reports rather than throwing, like the write. This is reached from an IPC
 * handler, and an escaping error there becomes a rejected invoke — which the
 * window shows as a generic failure with no idea that the key is still on disk.
 */
export function clearApiKey(userData: string): StoreResult {
  const path = keyPath(userData)
  try {
    // `rm -f` semantics: an absent file is success, which is what makes this
    // idempotent. Anything else is a real failure and must be said out loud.
    rmSync(path, { force: true })
    hints.set(path, null)
    return { ok: true }
  } catch (error: unknown) {
    console.error('[auth] the key could not be removed:', error)
    return { ok: false, why: 'write-failed' }
  }
}

/** Forget the cached hint. For tests, which write these files behind us. */
export function forgetKeyHints(): void {
  hints.clear()
}

/**
 * Whether this machine can store one at all. The pane says so before you try.
 *
 * `isEncryptionAvailable()` alone is NOT the question, and believing it was is
 * the bug this replaces. On Linux it returns true for the `basic_text`
 * backend, which Electron documents as encrypting with a hardcoded password --
 * so the ciphertext is decryptable by anyone with the file and the published
 * constant. The module promised "encrypted at rest or not written"; on that
 * backend it wrote a key that is plaintext in all but name, and reported
 * success.
 *
 * `unknown` is refused for the same reason: a backend nobody can name is not
 * one this can vouch for.
 */
export function canStoreSecrets(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  const backend = safeStorage.getSelectedStorageBackend()
  return backend !== 'basic_text' && backend !== 'unknown'
}
