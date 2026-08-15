/**
 * A key that lasts a minute, minted in the process that holds the long one.
 *
 * The bearer never leaves main and the ephemeral key never leaves main either
 * — the renderer gets neither. What crosses the bridge is SDP, which carries no
 * authority at all, so it can travel in both directions without being
 * protected. That is what lets the companion window keep a `connect-src` with
 * no `api.openai.com` in it: the renderer has nothing to send there.
 *
 * The spike put the ephemeral key in the renderer and fetched from there, which
 * is simpler and fine for a spike. It is not fine here, because that window
 * also loads a face out of a folder a user can write to.
 */

import { codexHome, type CodexProbe } from '../codex/status'
import { readAuthJson, readTokenState } from '../codex/auth'
import wire from '@shared/realtime-wire.json'
import type { CredentialSource } from '@shared/auth'

/**
 * How much of an upstream reply this will read.
 *
 * A deadline bounds how LONG a response may take and says nothing about how
 * BIG it may be: a slow trickle of megabytes stays inside the timeout the
 * whole way. Both bodies here are small by contract — a JSON object with a key
 * in it, and an SDP answer — so anything past this is either a service that
 * has changed shape or something in the middle that is not the service.
 */
const MAX_BODY_BYTES = 256 * 1024

/** Bounded, because every network call on a startup path needs to be. */
const TIMEOUT_MS = 30_000

export interface Credential {
  readonly bearer: string
  /** For logging. Never the value. */
  readonly source: 'chatgpt' | 'apikey'
}

/**
 * Why there is no usable bearer, when there is not one.
 *
 * A discriminated result rather than `null`. The single null collapsed "Codex
 * was never installed", "the file is unreadable", and "the login expired an
 * hour ago" into one outcome, so every caller reported the same unhelpful thing
 * -- and the one case a user can actually fix, an expired login, was the one
 * most likely to occur.
 */
export type CredentialProblem =
  /**
   * Nothing to borrow — and WHICH nothing, because the two have opposite
   * remedies. A single `absent` was described to the user as "no Codex
   * credential to borrow" whichever source was selected, so somebody who had
   * chosen API key and stored none was told to look at Codex.
   */
  | { readonly kind: 'absent'; readonly source: CredentialSource }
  | { readonly kind: 'expired' }
  | { readonly kind: 'unreadable'; readonly reason: string }

export type CredentialResult =
  | { readonly ok: true; readonly credential: Credential }
  | { readonly ok: false; readonly problem: CredentialProblem }

/**
 * Why a read failed, in words a renderer may see.
 *
 * The errno, not the exception. `String(error)` on a filesystem failure
 * carries the absolute path of `auth.json` — a home directory, and therefore a
 * username — and this reason is returned over IPC and shown. The code is what
 * distinguishes the cases anybody can act on; the path is detail for the log.
 */

/** One sentence, safe to log and safe to show. */
export function describeProblem(problem: CredentialProblem): string {
  switch (problem.kind) {
    case 'absent':
      return problem.source === 'apikey' ? 'no API key stored' : 'no Codex credential to borrow'
    case 'expired':
      return 'the Codex login has expired — run `codex login`'
    case 'unreadable':
      return `the Codex credential could not be read: ${problem.reason}`
  }
}

/**
 * The bearer, from whichever source this machine is set to use.
 *
 * An explicit choice rather than a precedence order. "Whichever is present
 * wins" would mean a Codex login from months ago quietly overriding a key
 * pasted this morning, and no way for the user to see which one answered.
 */
export function resolveCredential(
  source: CredentialSource,
  storedKey: string | null,
  probe?: CodexProbe,
  now: number = Date.now(),
): Promise<CredentialResult> {
  if (source === 'apikey') {
    return Promise.resolve(
      storedKey === null
        ? { ok: false, problem: { kind: 'absent', source: 'apikey' } }
        : { ok: true, credential: { bearer: storedKey, source: 'apikey' } },
    )
  }
  return readCodexCredential(probe, now)
}

async function readCodexCredential(
  probe?: CodexProbe,
  now: number = Date.now(),
): Promise<CredentialResult> {
  // The SHARED reader. A missing file is ordinary -- Codex is simply not
  // logged in -- and anything else is a real fault worth naming; collapsing
  // the two hid permission errors and truncated JSON behind "not logged in".
  // `codex/status.ts` asks the same question of the same file and now gets the
  // same answer, which is what stops the two drifting again.
  const read = await readAuthJson(codexHome(probe))
  if (!read.ok) {
    return read.missing
      ? { ok: false, problem: { kind: 'absent', source: 'codex' } }
      : { ok: false, problem: { kind: 'unreadable', reason: read.reason } }
  }
  const parsed: unknown = read.value

  // The SAME classifier the status probe uses, rather than a second parse.
  // This file used to walk `auth.json` itself and had already drifted: it
  // accepted any non-empty access token, expiry unread, so a long-running app
  // would happily mint with a token that died hours ago and fail at the moment
  // somebody spoke to her.
  const state = readTokenState(parsed, now)
  switch (state.kind) {
    case 'api-key': {
      const key = (parsed as Record<string, unknown>)['OPENAI_API_KEY']
      return typeof key === 'string' && key !== ''
        ? { ok: true, credential: { bearer: key, source: 'apikey' } }
        : { ok: false, problem: { kind: 'unreadable', reason: 'apikey mode with no key' } }
    }
    case 'valid': {
      const tokens = (parsed as Record<string, unknown>)['tokens'] as Record<string, unknown>
      const token = tokens['access_token']
      return typeof token === 'string' && token !== ''
        ? { ok: true, credential: { bearer: token, source: 'chatgpt' } }
        : { ok: false, problem: { kind: 'absent', source: 'codex' } }
    }
    case 'expired':
      return { ok: false, problem: { kind: 'expired' } }
    case 'absent':
      return { ok: false, problem: { kind: 'absent', source: 'codex' } }
    case 'unreadable':
      return { ok: false, problem: { kind: 'unreadable', reason: state.reason } }
  }
}

export interface MintResult {
  readonly ok: true
  readonly key: string
}
/**
 * A failure from either call here.
 *
 * Named for the domain rather than for `mintEphemeralKey`, which is what it
 * used to be called -- an SDP exchange returning a `MintFailure` made the
 * shared contract read as a copy-paste rather than a decision.
 */
export interface VoiceFailure {
  readonly ok: false
  /** Safe to show and safe to log. Never contains a credential. */
  readonly reason: string
}

/**
 * Trade the bearer for a short-lived client secret.
 *
 * On failure the response BODY is never included, only its error message: a
 * service that echoed the request back would otherwise put the bearer in a log.
 */
export async function mintEphemeralKey(
  credential: Credential,
  model: string = wire.defaultModel,
): Promise<MintResult | VoiceFailure> {
  let response: Response
  try {
    response = await fetch(wire.clientSecretsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: { type: 'realtime', model } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error: unknown) {
    // Named apart, because "it timed out" and "it refused" lead somewhere
    // different: one is the proxy, the other is the credential.
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      reason: timedOut ? `minting timed out after ${TIMEOUT_MS}ms` : `could not reach the service`,
    }
  }

  const text = await readBounded(response)
  if (text === null) return { ok: false, reason: 'the mint reply was too large' }
  let body: unknown = {}
  try {
    body = JSON.parse(text)
  } catch {
    body = {}
  }
  const key = (body as Record<string, unknown> | null)?.['value']
  // A NON-EMPTY STRING, not merely truthy. A shape change putting an object
  // here produces `Bearer [object Object]` and a 401 several steps later, with
  // nothing pointing back at this function.
  if (!response.ok || typeof key !== 'string' || key === '') {
    // The STATUS, never the upstream message. This reason is declared safe to
    // log and safe to show, and a service that echoes the request back -- or
    // quotes a header in its error -- would put the bearer straight into a log
    // file through it. The status says as much as anyone can act on.
    return { ok: false, reason: `mint failed: HTTP ${response.status}` }
  }
  return { ok: true, key }
}

/**
 * Hand the offer to the service and return its answer.
 *
 * 2xx rather than 200: this endpoint answers 201. And the body is checked for
 * an SDP shape, because an HTML error page with a 200 on it would otherwise be
 * handed to `setRemoteDescription`, which fails somewhere unrecognisable.
 */
export async function exchangeSdp(
  offer: string,
  key: string,
  model: string = wire.defaultModel,
): Promise<{ ok: true; answer: string } | VoiceFailure> {
  let response: Response
  try {
    response = await fetch(`${wire.callsUrl}?model=${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/sdp' },
      body: offer,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error: unknown) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      reason: timedOut ? 'the SDP exchange timed out' : 'the SDP exchange failed',
    }
  }

  // Inside its own guard. `response.text()` rejects on an interrupted or
  // malformed stream, and it sat outside the try -- so this function, which
  // promises a typed failure, threw instead.
  let answer: string
  try {
    const bounded = await readBounded(response)
    if (bounded === null) return { ok: false, reason: 'the SDP answer was too large' }
    answer = bounded
  } catch {
    return { ok: false, reason: 'the SDP answer could not be read' }
  }
  // `v=0` exactly, at the very start. RFC 4566 defines no other version, and
  // the old `^v=\d+` accepted `v=123garbage`.
  //
  // What this proves and what it does not: it proves the body is not an HTML
  // error page, a JSON error object, or an empty 200 -- which is what actually
  // arrives from a proxy, a captive portal, or a gateway. It does NOT prove
  // the SDP parses. A well-formed first line followed by nonsense still gets
  // here, and `setRemoteDescription` is the authoritative parser; re-implementing
  // enough of RFC 4566 to beat it would be a second parser to keep in step with
  // the first. The line exists to attach the HTTP status to the common failure,
  // because a rejection from `setRemoteDescription` carries no idea that the
  // answer came back 502.
  if (!response.ok || !/^v=0(\r\n|\n)/.test(answer)) {
    return { ok: false, reason: `the offer was not answered with SDP (HTTP ${response.status})` }
  }
  return { ok: true, answer }
}

/**
 * A response body, up to `MAX_BODY_BYTES`, or null if it exceeds that.
 *
 * Streamed rather than buffered whole. `response.text()` reads to completion
 * before anything can look at the size, so checking the length afterwards is
 * checking a value that is already in memory — which is precisely the failure
 * mode. This stops pulling at the limit.
 */
async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}
