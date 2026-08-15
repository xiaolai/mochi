/**
 * Who made her, and where she lives.
 *
 * The only pane with no settings in it, and the only one that leaves the app:
 * each address is opened by MAIN against an allowlist, because
 * `shell.openExternal` launches whatever is registered for a scheme and a
 * renderer that names the destination is a renderer that can launch anything.
 */

import type { Messages } from '@shared/i18n'
import type { SettingsSnapshot } from '@shared/ipc'
import { ExternalLink } from 'lucide'
import { icon } from '../../design/icon'
import { el } from '../form'

/** The window's one way of running something that can fail. See `act`. */
export type Act = (what: string, run: () => Promise<void>, after?: () => void) => void

/**
 * An address you can actually go to.
 *
 * A button, not an `<a href>`. A real link inside a `BrowserWindow` NAVIGATES
 * IT — the settings window would replace itself with GitHub, with no chrome to
 * come back from, which is the worst outcome available here. The click asks
 * main to hand the URL to the OS instead, and main opens it only if it is one
 * of the app's own two addresses.
 */
function externalLink(text: string, url: string, title: string, act: Act): HTMLElement {
  const link = el('button', { class: 'link', type: 'button', title }, [
    document.createTextNode(text),
    // Says the click LEAVES the app, which a bare underline does not. The
    // title carries the same fact in words; this carries it at a glance.
    icon(ExternalLink),
  ])
  link.addEventListener('click', () => {
    act(`could not open ${url}`, async () => {
      const opened = await window.mochiSettings.openExternal(url)
      // Refused rather than failed: main declined the address. Worth a line,
      // because the alternative is a button that does nothing and says
      // nothing about why.
      if (!opened) console.warn('[settings] main would not open', url)
    })
  })
  return link
}

export function aboutPane(
  t: Messages['settings'],
  snapshot: SettingsSnapshot,
  act: Act,
): HTMLElement {
  const rows: HTMLElement[] = []
  const add = (term: string, value: HTMLElement | string): void => {
    rows.push(el('dt', {}, [document.createTextNode(term)]))
    rows.push(el('dd', {}, [typeof value === 'string' ? document.createTextNode(value) : value]))
  }
  const { name, repository, author, homepage } = snapshot.about
  // The APP's name, not her persona's. She can be renamed to anything; this
  // group is about the build, and a build does not change name when she does.
  add(t.version, snapshot.version)
  add(
    t.repository,
    externalLink(repository.replace(/^https:\/\//, ''), repository, t.opensInBrowser, act),
  )
  // Text, not a link: `@xiaolai` is a handle, and which service it belongs to
  // is not something this pane should guess.
  add(t.author, author)
  add(
    t.homepage,
    externalLink(homepage.replace(/^https:\/\//, ''), homepage, t.opensInBrowser, act),
  )
  return el('div', { class: 'about' }, [
    el('p', { class: 'about-name' }, [document.createTextNode(name)]),
    el('dl', {}, rows),
  ])
}

/** What goes in each group. The five that exist, and the three that do not. */
