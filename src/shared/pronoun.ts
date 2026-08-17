/**
 * Which words the interface uses for her.
 *
 * A PRONOUN, not a gender. The distinction is not delicacy, it is correctness:
 * a gender flag has to be turned into words somewhere, and doing that by
 * interpolating into a template only works in languages that inflect the way
 * English does. `Wake her` and `叫醒她` differ in more than the pronoun. So the
 * unit that crosses the boundary is the pronoun, and each locale supplies
 * whole strings for each one.
 *
 * ## `they` was here and was removed
 *
 * It carried singular they -- one person, no gender stated -- written `TA` in
 * Chinese. The owner's call, made twice. It is recorded rather than quietly
 * dropped because the reasoning matters to whoever reconsiders it: `it` is the
 * remaining option for a persona nobody wants gendered, and `it` says thing
 * rather than someone.
 *
 * A persona file may still SAY `they`, so `parsePersona` maps it forward
 * rather than refusing the file -- see the note there.
 *
 * Deliberately NOT derived from the chosen voice. The Realtime voices carry no
 * gender metadata and several are androgynous by design -- `ballad`, her
 * default, among them -- so inferring a pronoun from a timbre is a guess, and
 * it would be wrong most often for exactly the people who care about it.
 */

export const PRONOUNS = ['she', 'he', 'it'] as const

/** A pronoun this app used to offer, kept only so stored personas survive. */
export const RETIRED_PRONOUNS = ['they'] as const

export function isRetiredPronoun(value: unknown): boolean {
  return typeof value === 'string' && (RETIRED_PRONOUNS as readonly string[]).includes(value)
}
export type Pronoun = (typeof PRONOUNS)[number]

export const DEFAULT_PRONOUN: Pronoun = 'she'

export function isPronoun(value: unknown): value is Pronoun {
  return typeof value === 'string' && (PRONOUNS as readonly string[]).includes(value)
}

/**
 * One phrasing per pronoun.
 *
 * `Record`, so a locale that adds a string and forgets a form does not compile.
 * Three short strings is more typing than one template; it is also the only
 * arrangement in which a translator can write what their language actually
 * says.
 */
export type ByPronoun = Readonly<Record<Pronoun, string>>

export function forPronoun(table: ByPronoun, pronoun: Pronoun): string {
  return table[pronoun]
}

/**
 * A label that may or may not depend on the pronoun.
 *
 * Most navigation labels do not -- "Sound" is "Sound" whoever she is -- and
 * writing four identical strings for them would be a choice that is not one.
 * A few are whole sentences about her and must vary, so the tables that hold
 * them are mixed, and this is what reads either kind.
 *
 * The alternative was a `ByPronoun` for every label, which puts the same word
 * in four slots and invites somebody to change one of them.
 */
export function label(value: string | ByPronoun, pronoun: Pronoun): string {
  return typeof value === 'string' ? value : value[pronoun]
}
