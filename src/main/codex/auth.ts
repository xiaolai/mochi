/**
 * How long the borrowed credential has left.
 *
 * `codex login status` answers "is there a login", which is Codex's question.
 * Ours is different and stricter: Codex reports itself logged in while holding
 * an EXPIRED access token, because it owns a refresh token and will renew on
 * its next run. We cannot renew -- the JWT's `client_id` is Codex's -- so for
 * us a stale token is unusable even though Codex considers itself fine.
 *
 * Measured 2026-08-11 on one token: `last_refresh` 2026-08-01T17:07:32Z against
 * an `exp` of 2026-08-11T17:07:32Z -- a lifetime of exactly TEN DAYS.
 *
 * An earlier version of this comment said 14.5 hours. That was the time
 * REMAINING when it was first read, recorded as though it were the lifetime,
 * and it made the whole arrangement look sixteen times more fragile than it is.
 * The check below is unchanged and was never wrong; only the reasoning about
 * how often it matters was.
 *
 * Ten days is still finite, and it still expires without warning for somebody
 * who has not opened Codex in a fortnight -- so an app asking only
 * `login status` would still sail past the exact state that breaks it. Rarer,
 * not absent, and rare failures are the ones nobody has a story for.
 *
 * Nothing here logs, returns or otherwise surfaces the token or the account id.
 * The only thing extracted from the JWT is `exp`.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type AuthMode = 'chatgpt' | 'apikey' | 'unknown'

export type TokenState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  /** An API key rather than a ChatGPT login. Usable as a bearer, and it does not expire. */
  | { readonly kind: 'api-key' }
  | { readonly kind: 'expired'; readonly expiredAt: Date }
  | { readonly kind: 'valid'; readonly expiresAt: Date }

/**
 * Treat a token expiring within this window as already gone.
 *
 * Minting an ephemeral key and opening a session takes a couple of seconds, and
 * a token that dies during it fails in the middle of her trying to speak rather
 * than before she starts. Cheaper to be told to re-login a minute early.
 */
export const EXPIRY_MARGIN_MS = 120_000

/** The `exp` claim, in ms, or null if this is not a JWT we can read. */
function expiryOf(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (payload === undefined) return null
  try {
    // Base64URL, and the padding a strict decoder wants.
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64')
    const claims: unknown = JSON.parse(decoded.toString('utf8'))
    if (typeof claims !== 'object' || claims === null) return null
    const exp = (claims as Record<string, unknown>)['exp']
    // Seconds since the epoch, per RFC 7519. A token without one has no
    // expressible lifetime and is treated as unreadable rather than eternal.
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * Classify the contents of `auth.json`.
 *
 * Takes the parsed contents rather than a path, so the whole decision is pure
 * and testable against tokens with any lifetime — including expired ones, which
 * are otherwise impossible to produce on demand.
 */
export function readTokenState(contents: unknown, now: number): TokenState {
  if (typeof contents !== 'object' || contents === null) {
    return { kind: 'unreadable', reason: 'auth.json did not contain an object' }
  }
  const root = contents as Record<string, unknown>

  const mode = root['auth_mode']
  const apiKey = root['OPENAI_API_KEY']
  if (typeof apiKey === 'string' && apiKey !== '') return { kind: 'api-key' }
  if (mode === 'apikey') {
    return { kind: 'unreadable', reason: 'auth.json says apikey mode but carries no key' }
  }

  const tokens = root['tokens']
  if (typeof tokens !== 'object' || tokens === null) return { kind: 'absent' }
  const token = (tokens as Record<string, unknown>)['access_token']
  if (typeof token !== 'string' || token === '') return { kind: 'absent' }

  const expiry = expiryOf(token)
  if (expiry === null) {
    // Not "assume it is fine". A token whose lifetime cannot be read is one we
    // cannot promise anything about, and the honest move is to say so rather
    // than to let her fail at the moment somebody speaks to her.
    return { kind: 'unreadable', reason: 'the access token carried no readable expiry' }
  }
  return expiry - EXPIRY_MARGIN_MS <= now
    ? { kind: 'expired', expiredAt: new Date(expiry) }
    : { kind: 'valid', expiresAt: new Date(expiry) }
}

/** Which login Codex is holding, for reporting only. */
export function authModeOf(contents: unknown): AuthMode {
  if (typeof contents !== 'object' || contents === null) return 'unknown'
  const mode = (contents as Record<string, unknown>)['auth_mode']
  if (mode === 'chatgpt' || mode === 'chatgpt_login') return 'chatgpt'
  if (mode === 'apikey') return 'apikey'
  return 'unknown'
}

/**
 * Read and parse `auth.json`, once, for everyone who asks about it.
 *
 * There were two of these — one here in the status probe, one in
 * `voice/credential.ts` — and they had already drifted apart in the way that
 * matters. `credential.ts` separates a MISSING file (Codex is simply not
 * logged in, which is ordinary) from an unreadable one (a permission error or
 * truncated JSON, which is a fault worth naming), and describes the failure by
 * errno. The status probe collapsed both into one string built with
 * `String(error)` — and a `readFileSync` error message contains the absolute
 * path, so a home directory went into a status a user can be shown. That is
 * precisely the leak `credential.ts` was changed to avoid.
 */
export type AuthFileRead =
  | { readonly ok: true; readonly value: unknown }
  /** No file. Codex is not logged in; nothing is wrong. */
  | { readonly ok: false; readonly missing: true }
  /** A file that exists and could not be used. Never carries a path. */
  | { readonly ok: false; readonly missing: false; readonly reason: string }

/**
 * A ceiling on the file.
 *
 * A Codex `auth.json` is a few kilobytes: a token, an expiry, a mode. It sits
 * in a user-writable directory, so its size is not this module's to assume --
 * without a bound the whole thing is read into main's heap and handed to
 * `JSON.parse` before anything can object.
 */
const MAX_AUTH_BYTES = 256 * 1024

export async function readAuthJson(home: string): Promise<AuthFileRead> {
  const path = join(home, 'auth.json')
  try {
    // ASYNC, and bounded. This runs on the main thread for every session open,
    // and a home directory can be a network mount -- the same reason the rest
    // of the Codex probe stopped using the sync calls.
    const stats = await stat(path)
    if (!stats.isFile()) return { ok: false, missing: false, reason: 'it is not a file' }
    if (stats.size > MAX_AUTH_BYTES) {
      return { ok: false, missing: false, reason: 'it is far larger than a credential file' }
    }
    return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, missing: true }
    return { ok: false, missing: false, reason: describeReadFailure(error) }
  }
}

/**
 * Why a read failed, by errno rather than by message.
 *
 * `String(error)` carries the absolute path of the file, which is a home
 * directory, which is a username. An errno says as much as the reader can act
 * on and nothing about where the machine keeps things.
 */
export function describeReadFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied'
  if (code === 'EISDIR' || code === 'ENOTDIR') return 'the path is not a file'
  if (code === 'ENOENT') return 'it is not there'
  return code === undefined ? 'it is not readable' : `it could not be read (${code})`
}
