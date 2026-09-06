/**
 * Drop-in registration. `import '@hando/dough/element'` and the tag works.
 *
 * **Browser only** — see the note in `./dough-avatar`. This module is listed in
 * the package's `sideEffects` array precisely because it has one: importing it
 * registers the element, and a blanket `"sideEffects": false` let bundlers drop
 * the documented bare import entirely and emit nothing.
 */
import { DoughAvatarElement } from './dough-avatar'

export { DoughAvatarElement } from './dough-avatar'

/**
 * Whether the base class has been handed to `customElements` yet.
 *
 * A constructor may be registered exactly ONCE. Registering the same class
 * under a second tag throws `NotSupportedError`, so checking only whether the
 * requested NAME is free is not enough — after the automatic registration
 * below, every explicit `defineDoughAvatar('my-avatar')` hit that error.
 * Additional names therefore get their own trivial subclass.
 */
let baseRegistered = false

export function defineDoughAvatar(tag = 'dough-avatar'): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(tag) !== undefined) return
  if (baseRegistered) {
    customElements.define(tag, class extends DoughAvatarElement {})
    return
  }
  customElements.define(tag, DoughAvatarElement)
  baseRegistered = true
}

defineDoughAvatar()
