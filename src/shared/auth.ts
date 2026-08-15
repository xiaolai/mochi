/**
 * Where her bearer comes from.
 *
 * Two sources, chosen explicitly rather than by precedence. "Whichever is
 * present wins" reads as convenient and produces the one question a support
 * thread cannot answer: which credential is it actually using? A user who has
 * both — a Codex login from months ago and a key pasted today — should not have
 * to reason about an order they never saw.
 */

export const CREDENTIAL_SOURCES = ['codex', 'apikey'] as const
export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number]

export const DEFAULT_CREDENTIAL_SOURCE: CredentialSource = 'codex'

export function isCredentialSource(value: unknown): value is CredentialSource {
  return typeof value === 'string' && (CREDENTIAL_SOURCES as readonly string[]).includes(value)
}

/** The longest key we will entertain, and the longest paste we will examine. */
const MAX_KEY = 400
const MAX_PASTE = 4096

/** What is wrong with a pasted key, before anything is sent anywhere. */
export type KeyShapeProblem = 'empty' | 'whitespace' | 'prefix' | 'short' | 'long'

/** Why a well-formed key could not be written. See `main/voice/key-store.ts`. */
export type KeyStoreProblem = 'no-keychain' | 'write-failed'

/**
 * Does this look like an OpenAI key?
 *
 * A SHAPE check, not a validity check — only OpenAI can say whether a key
 * works, and finding out costs a network round trip. The point is to catch the
 * mistakes that are obvious locally: a pasted URL, a truncated copy, a
 * whole-line paste with trailing whitespace, the placeholder from a tutorial.
 * Each of those would otherwise surface as a failed wake fifteen seconds later,
 * with nothing pointing at the key.
 *
 * Deliberately permissive about the middle. OpenAI has changed the format more
 * than once — `sk-`, then `sk-proj-`, with varying lengths — so anything
 * stricter than "the prefix and a plausible length" would reject valid keys the
 * day they introduce the next variant.
 *
 * Surrounding whitespace is TRIMMED and accepted, not rejected: a paste picks
 * up a trailing newline constantly and refusing that would be pedantry. The
 * comment above used to claim it was caught as an error, which it never was.
 * Whitespace in the MIDDLE is a different thing and is refused — that means a
 * whole line was pasted, key included.
 */
export function apiKeyProblem(key: string): KeyShapeProblem | null {
  // LENGTH first, before anything scans or allocates. This string arrives over
  // IPC from a renderer, so its size is not ours to assume, and `trim()` on a
  // multi-megabyte value copies it before any check has run.
  if (key.length > MAX_PASTE) return 'long'
  const trimmed = key.trim()
  if (trimmed === '') return 'empty'
  // Control characters as well as spaces. An invisible character survives a
  // paste, survives this check as it was, and then fails inside `fetch` --
  // where Node puts the whole header value in the exception message.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return 'whitespace'
  if (!trimmed.startsWith('sk-')) return 'prefix'
  if (trimmed.length < 20) return 'short'
  if (trimmed.length > MAX_KEY) return 'long'
  return null
}

/**
 * A key as it may be SHOWN. Never the key.
 *
 * The last four characters and nothing else, which is enough to tell two keys
 * apart and useless to anyone reading over a shoulder or a screen recording.
 * Even this never crosses to the renderer as part of the key itself — main
 * computes it and sends the hint alone.
 */
export function keyHint(key: string): string {
  const trimmed = key.trim()
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`
}

/**
 * What to do about a Codex that cannot be used.
 *
 * In `shared/` rather than in `main/codex/status.ts`, where it started. Both
 * processes name it — the settings window reports it and `i18n/messages.ts`
 * already keys a table by it — and `shared` importing from `main` pulls the
 * node types into the renderer build, which is how the layering breaks.
 */
/**
 * `store-key` is not a Codex remedy, and that is the point.
 *
 * The other three tell you to do something to the Codex CLI. When the selected
 * source is an API key and none is stored, none of them is the right
 * instruction — offering `login` would send somebody to a terminal to fix a
 * text field. A fourth member costs two strings per locale and makes the wrong
 * advice unrepresentable.
 */
export const REMEDIES = ['install', 'reinstall', 'login', 'store-key', 'retry'] as const
export type Remedy = (typeof REMEDIES)[number]
