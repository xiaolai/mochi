import type { CapabilityManifest } from './manifest'

/**
 * A tool call's arguments, read against the manifest that declared them.
 *
 * This replaces v1's three one-line functions — `readQuestion`,
 * `readRecallQuery`, `readRememberNote` — which differed only in a string
 * literal. Three named parsers for one parameterised call is not sloppiness;
 * it is what a closed set costs, and it is the part that disappears when the
 * set stops being closed.
 *
 * ## Never throws, and that is load-bearing
 *
 * `arguments` arrives as a JSON *string* and it is MODEL OUTPUT: its shape is
 * not ours to assume. Every failure yields an empty string rather than an
 * exception, because the caller must still answer the call — a tool call that
 * never receives a `function_call_output` leaves the conversation holding an
 * unanswered one for the rest of the session. v1's header says exactly this,
 * and the behaviour is preserved field for field rather than re-derived.
 *
 * ## Every declared field is present in the result
 *
 * Missing, wrong-typed and unparseable all collapse to `''`. A caller reading
 * `args.question` therefore never gets `undefined`, which is what let v1's
 * call sites stay free of optional handling.
 */
export function readArgs(
  manifest: CapabilityManifest,
  raw: unknown,
): Readonly<Record<string, string>> {
  const fields = Object.keys(manifest.parameters.properties)
  const blank = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const field of fields) out[field] = ''
    return out
  }

  if (typeof raw !== 'string') return blank()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return blank()
  }

  // `typeof null === 'object'`, and an array is an object too. Both reach here
  // and both simply have none of the declared keys, so they fall through to the
  // same empty strings rather than needing a branch of their own.
  if (typeof parsed !== 'object' || parsed === null) return blank()

  const source = parsed as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const field of fields) {
    const value = source[field]
    out[field] = typeof value === 'string' ? value : ''
  }
  return out
}
