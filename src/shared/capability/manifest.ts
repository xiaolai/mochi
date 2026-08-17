/**
 * A capability, as data.
 *
 * This is the plugin format for things she can *do*, and it deliberately copies
 * the reasoning `avatar-spec.ts` already established for things she *looks*
 * like: a capability a user installs is a JSON file, and the executable half is
 * reached through it rather than shipped inside it. Data cannot escalate.
 *
 * ## Why this exists at all
 *
 * v1 declared its three tools as a frozen array in the renderer, with a comment
 * saying "the set is closed on purpose". Adding a fourth meant editing five
 * files across the process boundary — the array, a name constant, a bespoke
 * argument reader, a callback on the session interface, a branch in an
 * `if/else` chain, an IPC message kind, and a handler in main. A user can do
 * none of those. That is the entire content of "not extensible": not a missing
 * feature, a shape.
 *
 * ## Every field is bounded, not merely typed
 *
 * These values arrive from a file somebody else wrote. Type-checking alone
 * accepts a 40 KB description, a name with a slash in it, or a `required` entry
 * naming a property that does not exist — none of which throw. They produce a
 * session that configures cleanly and then behaves wrongly, with nothing in any
 * log saying which field did it. So every field declares a range and the range
 * is checked here, at the boundary, rather than defended against downstream.
 *
 * ## String arguments only, and it is a refusal rather than a silence
 *
 * All three of v1's tools take exactly one string. Supporting the rest of JSON
 * Schema would mean shipping a validator nobody has run against the live
 * service, and this project has twice shipped mechanisms reasoned from
 * documentation that were dead on arrival. So the subset is what is verified,
 * and anything outside it is rejected by name — a manifest declaring
 * `type: 'number'` fails loudly at load instead of reaching the wire as a field
 * the model will fill with something we cannot read.
 */

/** A single declared argument. Strings only — see the header. */
export interface CapabilityProperty {
  readonly type: 'string'
  readonly description: string
}

export interface CapabilityParameters {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, CapabilityProperty>>
  readonly required: readonly string[]
}

export interface CapabilityManifest {
  readonly name: string
  readonly description: string
  readonly parameters: CapabilityParameters
}

/**
 * Why a manifest was rejected.
 *
 * A discriminated union rather than a boolean or a string, because the caller
 * has to tell the user which file is wrong and what about it — "one of your
 * capabilities failed to load" is the message that makes people delete the
 * folder and start again.
 */
export type ManifestProblem =
  | { readonly kind: 'not-an-object' }
  | { readonly kind: 'bad-name'; readonly value: unknown }
  | { readonly kind: 'bad-description'; readonly length: number }
  | { readonly kind: 'bad-parameters' }
  | { readonly kind: 'no-properties' }
  | { readonly kind: 'too-many-properties'; readonly count: number }
  | { readonly kind: 'bad-property-name'; readonly property: string }
  | {
      readonly kind: 'unsupported-property-type'
      readonly property: string
      readonly type: unknown
    }
  | { readonly kind: 'bad-property-description'; readonly property: string }
  | { readonly kind: 'required-not-declared'; readonly property: string }
  | { readonly kind: 'required-duplicated'; readonly property: string }

export type ManifestResult =
  | { readonly ok: true; readonly manifest: CapabilityManifest }
  | { readonly ok: false; readonly problem: ManifestProblem }

/**
 * Tool names travel on the wire and are the dispatch key, so the character set
 * is the intersection of "what the service accepts" and "what cannot be
 * confused with something else". No dots, no slashes, no capitals: a name that
 * differs from a built-in only by case is a name that reads as the built-in.
 */
const NAME = /^[a-z][a-z0-9_]{0,63}$/

/** The description enters the model's context on every session. */
const MAX_DESCRIPTION = 4096
const MAX_PROPERTY_DESCRIPTION = 1024
const MAX_PROPERTIES = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseManifest(value: unknown): ManifestResult {
  if (!isRecord(value)) return { ok: false, problem: { kind: 'not-an-object' } }

  const name = value['name']
  if (typeof name !== 'string' || !NAME.test(name)) {
    return { ok: false, problem: { kind: 'bad-name', value: name } }
  }

  const description = value['description']
  if (
    typeof description !== 'string' ||
    description.trim().length === 0 ||
    description.length > MAX_DESCRIPTION
  ) {
    return {
      ok: false,
      problem: {
        kind: 'bad-description',
        length: typeof description === 'string' ? description.length : 0,
      },
    }
  }

  const parameters = value['parameters']
  if (!isRecord(parameters) || parameters['type'] !== 'object') {
    return { ok: false, problem: { kind: 'bad-parameters' } }
  }

  const rawProperties = parameters['properties']
  if (!isRecord(rawProperties)) return { ok: false, problem: { kind: 'bad-parameters' } }

  const names = Object.keys(rawProperties)
  if (names.length === 0) return { ok: false, problem: { kind: 'no-properties' } }
  if (names.length > MAX_PROPERTIES) {
    return { ok: false, problem: { kind: 'too-many-properties', count: names.length } }
  }

  const properties: Record<string, CapabilityProperty> = {}
  for (const property of names) {
    if (!NAME.test(property)) {
      return { ok: false, problem: { kind: 'bad-property-name', property } }
    }
    const declared = rawProperties[property]
    if (!isRecord(declared)) {
      return { ok: false, problem: { kind: 'bad-parameters' } }
    }
    if (declared['type'] !== 'string') {
      return {
        ok: false,
        problem: { kind: 'unsupported-property-type', property, type: declared['type'] },
      }
    }
    const propertyDescription = declared['description']
    if (
      typeof propertyDescription !== 'string' ||
      propertyDescription.trim().length === 0 ||
      propertyDescription.length > MAX_PROPERTY_DESCRIPTION
    ) {
      return { ok: false, problem: { kind: 'bad-property-description', property } }
    }
    properties[property] = { type: 'string', description: propertyDescription }
  }

  const rawRequired = parameters['required']
  if (!Array.isArray(rawRequired)) return { ok: false, problem: { kind: 'bad-parameters' } }

  const required: string[] = []
  for (const entry of rawRequired) {
    // `Object.hasOwn`, not `in`. `'constructor' in properties` is true for any
    // plain object, so `in` would accept a `required` entry naming a prototype
    // member and put a tool on the wire demanding an argument nothing declares.
    if (typeof entry !== 'string' || !Object.hasOwn(properties, entry)) {
      return {
        ok: false,
        problem: { kind: 'required-not-declared', property: String(entry) },
      }
    }
    if (required.includes(entry)) {
      return { ok: false, problem: { kind: 'required-duplicated', property: entry } }
    }
    required.push(entry)
  }

  return {
    ok: true,
    manifest: { name, description, parameters: { type: 'object', properties, required } },
  }
}
