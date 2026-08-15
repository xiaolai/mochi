/**
 * Which language she speaks to you in.
 *
 * Adding a language is two edits: write a locale file, add one entry to
 * `LOCALES`. No call site changes -- that is the property the explicit
 * `Messages` interface exists to guarantee.
 *
 * The interface language and the PERSONA's language are orthogonal axes and
 * must not be conflated. This is the first: what her menus say. What she says
 * is a property of the persona, and somebody may well want an English menu and
 * a Chinese companion.
 */

import type { Messages } from './messages'
export {
  PANE_GROUPS,
  PANE_KEYS,
  SETUP_SECTIONS,
  type PaneGroupKey,
  type PaneKey,
  type SetupSection,
} from './messages'
import { en } from './en'
import { zhCN } from './zh-CN'

export type { Messages }

export interface LocaleInfo {
  readonly messages: Messages
  /**
   * The language's name IN that language, never translated.
   *
   * Somebody who cannot read the current interface has to be able to find their
   * way back out of it, and "Chinese" is no help to a reader who only reads
   * 中文.
   */
  readonly nativeName: string
  /**
   * Present from the start although every value is `ltr` today.
   *
   * Adding the field later, once an RTL language arrives, means auditing every
   * layout at once. Adding it now costs a word per locale.
   */
  readonly direction: 'ltr' | 'rtl'
}

export const LOCALES = {
  en: { messages: en, nativeName: 'English', direction: 'ltr' },
  'zh-CN': { messages: zhCN, nativeName: '简体中文', direction: 'ltr' },
} as const satisfies Record<string, LocaleInfo>

export type LocaleTag = keyof typeof LOCALES
export const LOCALE_TAGS = Object.keys(LOCALES) as readonly LocaleTag[]
export const DEFAULT_LOCALE: LocaleTag = 'en'

export function isLocaleTag(value: unknown): value is LocaleTag {
  // `Object.hasOwn`, NOT `in`. `in` walks the prototype chain, so `'toString'`,
  // `'constructor'` and `'valueOf'` all answered true -- and `messagesFor` would
  // then dereference `Function.prototype.toString.messages` and throw. A locale
  // tag arrives from the OS and, later, from a settings file, so this is a
  // boundary check and it has to mean what it says.
  return typeof value === 'string' && Object.hasOwn(LOCALES, value)
}

/**
 * The best match for what the OS reports.
 *
 * Falls back through the base language, so `zh-Hans-CN` and `zh-CN` both reach
 * Simplified Chinese rather than dropping to English on a tag nobody enumerated.
 * An exact-match-only lookup is how a correct locale becomes an English menu.
 */
export function resolveLocale(preferred: string | null | undefined): LocaleTag {
  if (!preferred) return DEFAULT_LOCALE
  if (isLocaleTag(preferred)) return preferred
  const base = preferred.split('-')[0]?.toLowerCase()
  if (base === undefined) return DEFAULT_LOCALE
  return LOCALE_TAGS.find((tag) => tag.toLowerCase().split('-')[0] === base) ?? DEFAULT_LOCALE
}

export function messagesFor(tag: LocaleTag): Messages {
  return LOCALES[tag].messages
}

/**
 * `{name}` substitution.
 *
 * A placeholder with no value is left standing rather than replaced with an
 * empty string: `Quit ` reads as a rendering bug with nothing to point at,
 * while `Quit {app}` names the key that went missing.
 */
export function format(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
}
