/**
 * A capability, as data.
 *
 * The half of a capability that goes on the wire: what she is told she can do
 * and what arguments it takes. It lives in `@shared` because the renderer
 * typechecks against it; the handler half is `src/capabilities/kind.ts`, and
 * `src/capabilities/<name>/capability.ts` holds both as one value so a manifest
 * cannot exist without an implementation.
 *
 * This was written as a format for something a user would INSTALL — a JSON file
 * in a folder, with the executable half reached through it rather than shipped
 * inside it. Nobody installs one now: a capability is a folder in the source
 * that whoever runs this compiled. The bounds below survived that change
 * unaltered, and the reason is in the next section — they were never really
 * about the file being a stranger's.
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
 * Type-checking alone accepts a 40 KB description, a name with a slash in it, or
 * a `required` entry naming a property that does not exist — none of which
 * throw. They produce a session that configures cleanly and then behaves
 * wrongly, with nothing in any log saying which field did it.
 *
 * That is true of a manifest somebody wrote in TypeScript this morning as much
 * as of one downloaded from a stranger. The description enters the model's
 * context on every session and is billed for the life of it; the name is the
 * dispatch key and goes on the wire. Neither cares who typed it. So every field
 * declares a range, the range is checked here, and `src/capabilities` asserts
 * the whole collected set passes — which makes a bad one fail the build rather
 * than the launch.
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
  /**
   * The values this argument may take, when there is a closed set of them.
   *
   * On the wire, so the model is CONSTRAINED rather than asked. The alternative
   * — describing the options in prose and validating on the way back — makes a
   * refusal the normal path for a mistake the schema could have prevented.
   *
   * A manifest declares a fixed set, the same for every session. One capability
   * used to have its enum narrowed per character before it went on the wire —
   * `set_expression`, which was removed on 2026-08-26 — and no manifest is
   * per-character today.
   *
   * A value outside the enum is still refused by the handler, because a
   * manifest is a request and not a guarantee.
   */
  readonly enum?: readonly string[]
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
 * has to say which field is wrong and what about it. "A capability failed to
 * load" is the message that sends somebody through every folder guessing.
 */
export type ManifestProblem =
  | { readonly kind: 'not-an-object' }
  | { readonly kind: 'bad-name'; readonly value: unknown }
  | { readonly kind: 'bad-description'; readonly length: number }
  | { readonly kind: 'bad-parameters' }
  | { readonly kind: 'no-properties' }
  | { readonly kind: 'too-many-properties'; readonly count: number }
  | { readonly kind: 'bad-property-name'; readonly property: string }
  /**
   * An argument called `description`, which the prompt catalogue cannot key.
   *
   * `toolDescriptionKey(name)` is `tool.<name>.description` and
   * `toolArgumentKey(name, argument)` is `tool.<name>.<argument>`, so an
   * argument with that name generates the identical key. Two catalogue entries
   * would share it — with different titles, different limits, and one override
   * silently governing both.
   *
   * Refused here rather than worked around there, because it makes the
   * collision unrepresentable and costs nothing: no manifest in this build uses
   * the name, and changing the key shape instead would strand every override
   * anybody had already stored under the old one.
   */
  | { readonly kind: 'reserved-property-name'; readonly property: string }
  | {
      readonly kind: 'unsupported-property-type'
      readonly property: string
      readonly type: unknown
    }
  | { readonly kind: 'bad-property-description'; readonly property: string }
  /** An `enum` that is not a bounded, non-empty set of distinct strings. */
  | { readonly kind: 'bad-property-enum'; readonly property: string }
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

/**
 * Whether a string is a capability name, for anything that reads one back.
 *
 * `usage.ts` keys a stored file by capability name, so it has to check the keys
 * it reads rather than trust them — the same rule `isPersonaId` and
 * `isProfileName` follow at the line where a stored string becomes a lookup.
 * Exported rather than duplicated: two spellings of this grammar is how one of
 * them quietly accepts something the other refuses.
 */
export function isCapabilityName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value)
}

/**
 * The description enters the model's context on every session.
 *
 * EXPORTED, because a manifest is no longer the only way one of these strings
 * reaches the wire. The prompt catalogue offers every tool description and every
 * argument description for rewriting, and an override is written to a file this
 * function never sees — so the bound has to be applied a second time, where the
 * override is saved and again where the wire list is built. The header's
 * argument is what makes that necessary rather than tidy: these bounds were
 * never about the manifest being a stranger's, and a 100 KB description
 * somebody pasted this morning is billed for the life of every session just as
 * surely as a downloaded one.
 */
export const MAX_DESCRIPTION = 4096
export const MAX_PROPERTY_DESCRIPTION = 1024
const MAX_PROPERTIES = 8

/**
 * The one argument name a tool may not have.
 *
 * `tool.<name>.description` is the tool's OWN description in the prompt
 * catalogue, and an argument by that name builds the same string. See
 * `reserved-property-name`.
 */
const RESERVED_PROPERTY = 'description'
/**
 * How large a closed set may be, and how long one of its values.
 *
 * Bounded for the reason everything else here is: an enum goes on the wire on
 * every session and is billed for the life of it, and a thousand-value set is a
 * constraint nobody wrote deliberately.
 */
const MAX_ENUM_VALUES = 32
const MAX_ENUM_VALUE_CHARS = 64

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
    // See `reserved-property-name`: this one collides with the tool's own
    // description in the prompt catalogue, and the catalogue has no way to tell
    // the two apart once they have the same key.
    if (property === RESERVED_PROPERTY) {
      return { ok: false, problem: { kind: 'reserved-property-name', property } }
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
    /*
      `enum` CARRIED THROUGH, and checked. It was neither.

      `CapabilityProperty.enum` says what it is for: *"On the wire, so the model
      is CONSTRAINED rather than asked. The alternative — describing the options
      in prose and validating on the way back — makes a refusal the normal path
      for a mistake the schema could have prevented."* This parser read the type
      and the description and dropped it, so a manifest declaring one was
      accepted and silently widened to an unrestricted string.

      Latent rather than live: no manifest in this build declares one, which is
      why nothing failed — and why `prompts.test.ts`'s assertion that
      `describedTools` preserves an enum was passing over an empty set.

      Bounded like every other field here, because the header's rule is that
      type-checking alone accepts a 40 KB description or a `required` naming a
      property that does not exist: every field declares a range and the range is
      checked. An empty enum is refused rather than treated as absent — it would
      put a closed set with nothing in it on the wire, which no value can satisfy.
    */
    const declaredEnum = declared['enum']
    if (declaredEnum !== undefined) {
      if (
        !Array.isArray(declaredEnum) ||
        declaredEnum.length === 0 ||
        declaredEnum.length > MAX_ENUM_VALUES ||
        declaredEnum.some(
          (value) =>
            typeof value !== 'string' ||
            value.trim().length === 0 ||
            value.length > MAX_ENUM_VALUE_CHARS,
        ) ||
        new Set(declaredEnum).size !== declaredEnum.length
      ) {
        return { ok: false, problem: { kind: 'bad-property-enum', property } }
      }
      properties[property] = {
        type: 'string',
        description: propertyDescription,
        enum: [...(declaredEnum as string[])],
      }
      continue
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
