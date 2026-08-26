import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import wire from '@shared/realtime-wire.json'
import { readTokenState } from '../codex/auth'
import { DEFAULT_REALTIME_MODEL, type RealtimeModel } from '@shared/realtime-model'

/**
 * The credential, and the two calls that turn it into a session.
 *
 * ## Everything here runs in main, and that is the point
 *
 * The bearer never crosses to the renderer. The renderer gets a peer connection
 * and, at most, frames — never a key. §2 established the same boundary for
 * capabilities: the loop stays on this machine, and the credential and the work
 * never meet.
 *
 * ## One credential source, and it is Codex
 *
 * There is no API-key path. `~/.codex/auth.json` (or `$CODEX_HOME`) holds a
 * ChatGPT-subscription OAuth token, and §24 verified that this credential
 * reaches the `gpt-realtime-2` line — so the subscription is the whole
 * arrangement rather than a fallback.
 *
 * ## The failure that is worth naming separately
 *
 * §51: the stored `access_token` goes stale somewhere between 5 and 17 days, and
 * **nothing refreshes it except using the CLI**. A machine that has been running
 * for weeks without anybody typing `codex` has a credential that fails at the
 * first mint, and the failure arrives as a bare `401` at the moment a session
 * opens — the least informative place to discover it.
 *
 * "Logged out" and "logged in, token stale" are different problems with
 * different remedies, and the file exists and parses in both cases. So a `401`
 * on the mint is reported as its own kind, with the fix in it.
 *
 * ## Staleness is now caught BEFORE the mint, and the 401 path stays anyway
 *
 * The token carries its own `exp`, so the common case — a machine nobody has
 * opened Codex on for a fortnight — is answered from the file rather than from
 * a rejected request. The 401 branch below is not redundant: a token can be
 * revoked, or the account changed, while the claim it carries is still in the
 * future, and only the service knows that.
 */

const AUTH_FILE = 'auth.json'

export type CredentialProblem =
  | { readonly kind: 'no-auth-file'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly why: string }
  | { readonly kind: 'no-token' }
  /** The token is there and the service refused it. Almost always staleness. */
  | { readonly kind: 'stale-token'; readonly lastRefresh: string | null }
  | { readonly kind: 'refused'; readonly status: number; readonly body: string }
  | { readonly kind: 'unreachable'; readonly why: string }

export function describeProblem(problem: CredentialProblem): string {
  switch (problem.kind) {
    case 'no-auth-file':
      return `no Codex credential at ${problem.path} — run \`codex\` once to sign in`
    case 'unreadable':
      return `the Codex credential could not be read: ${problem.why}`
    case 'no-token':
      return 'the Codex credential has no access token — run `codex` once to sign in'
    case 'stale-token':
      return (
        'the Codex token was refused' +
        (problem.lastRefresh === null ? '' : ` (last refreshed ${problem.lastRefresh})`) +
        ' — run `codex` once on this machine to refresh it'
      )
    case 'refused':
      return `the service refused the credential (HTTP ${problem.status}): ${problem.body.slice(0, 200)}`
    case 'unreachable':
      return `the service could not be reached: ${problem.why}`
  }
}

export interface Bearer {
  readonly token: string
  /** For the staleness message. `null` when the file does not carry one. */
  readonly lastRefresh: string | null
}

export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: CredentialProblem }

export function readBearer(
  home = process.env.CODEX_HOME ?? join(homedir(), '.codex'),
): Read<Bearer> {
  const path = join(home, AUTH_FILE)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    /*
      BY ERRNO, which is what `codex/auth.ts` already says this does.

      That comment cites this function as describing the failure by errno; it
      interpolated `String(error)` instead, which produces a sentence carrying
      the absolute path of somebody's home directory and no machine-readable
      cause. So the caller could not distinguish "your Codex login is not
      readable by this app" (EACCES — actionable, and the common one on a
      restored-from-backup machine) from any other fault.
    */
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, problem: { kind: 'no-auth-file', path } }
    return {
      ok: false,
      problem: { kind: 'unreadable', why: code ?? 'the file could not be read' },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, problem: { kind: 'unreadable', why: 'auth.json is not JSON' } }
  }

  const record = parsed as { tokens?: { access_token?: unknown }; last_refresh?: unknown }
  const token = record.tokens?.access_token
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, problem: { kind: 'no-token' } }
  }
  const lastRefresh = typeof record.last_refresh === 'string' ? record.last_refresh : null

  /*
    The token's OWN expiry, read before it is used rather than after it fails.

    §51 is the whole of this file's header: the stored `access_token` goes stale
    somewhere between 5 and 17 days, nothing refreshes it except running the
    CLI, and the failure arrived as a bare 401 at the moment a session opened —
    the least informative place to discover it. That path is still below and
    still needed, because a token can be revoked while perfectly unexpired.

    What is new is that the ordinary case no longer has to reach it. The `exp`
    claim is in the token, `codex/auth.ts` reads it, and a credential that will
    not survive the next two minutes is reported here — before the mint, before
    the peer, before she opens her mouth. Same problem, same remedy, several
    seconds and one network round trip earlier.

    `readTokenState` rather than a second decoder: `codex/status.ts` asks the
    same question for the settings window, and two answers to "is this token
    alive" would disagree the first time either changed.
  */
  const state = readTokenState(parsed, Date.now())
  if (state.kind === 'expired') {
    return { ok: false, problem: { kind: 'stale-token', lastRefresh } }
  }

  return { ok: true, value: { token, lastRefresh } }
}

/** What the renderer is allowed to hold: a short-lived key, never the bearer. */
export interface Minted {
  readonly key: string
  readonly model: RealtimeModel
}

export async function mintEphemeralKey(input: {
  readonly bearer: Bearer
  readonly model?: RealtimeModel
  readonly fetch?: typeof globalThis.fetch
}): Promise<Read<Minted>> {
  const model = input.model ?? DEFAULT_REALTIME_MODEL
  const send = input.fetch ?? globalThis.fetch

  let response: Response
  try {
    response = await send(wire.clientSecretsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.bearer.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: { type: 'realtime', model } }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error: unknown) {
    return { ok: false, problem: { kind: 'unreachable', why: String(error) } }
  }

  if (response.status === 401) {
    // §51. The token parses, the account is right, and the service says no.
    return { ok: false, problem: { kind: 'stale-token', lastRefresh: input.bearer.lastRefresh } }
  }
  if (!response.ok) {
    return {
      ok: false,
      problem: { kind: 'refused', status: response.status, body: await response.text() },
    }
  }

  const body = (await response.json()) as { value?: unknown }
  if (typeof body.value !== 'string' || body.value.length === 0) {
    return { ok: false, problem: { kind: 'unreadable', why: 'the mint returned no key' } }
  }
  return { ok: true, value: { key: body.value, model } }
}

/**
 * The SDP exchange. Done here so the renderer never holds even the minted key.
 *
 * §48 measured this at 1.8–4.6s across two networks — the slowest single step in
 * opening a session, and the reason `reconnect.ts` budgets six seconds.
 */
export async function exchangeSdp(input: {
  readonly offer: string
  readonly minted: Minted
  readonly fetch?: typeof globalThis.fetch
}): Promise<Read<string>> {
  const send = input.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await send(`${wire.callsUrl}?model=${input.minted.model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.minted.key}`,
        'Content-Type': 'application/sdp',
      },
      body: input.offer,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error: unknown) {
    return { ok: false, problem: { kind: 'unreachable', why: String(error) } }
  }

  const answer = await response.text()
  // 201 is what the service actually returns; 200 accepted because a status
  // change of that shape should not take the app down.
  if (response.status !== 201 && response.status !== 200) {
    return { ok: false, problem: { kind: 'refused', status: response.status, body: answer } }
  }
  return { ok: true, value: answer }
}
