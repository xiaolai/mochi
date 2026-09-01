/** The "about" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * What this build is.
 *
 * ## It used to be two panes wearing one name
 *
 * This answered "what is this application" and "where does it keep everything"
 * in the same list, and the join was that both are short. Its last row was the
 * deletion that forgets every conversation of every character — the most
 * irreversible thing this application can do, under a version number, in a
 * group called About. Legible and unfindable, which is the combination that
 * gets a destructive control pressed by somebody who came for something else.
 *
 * The folders, the root they sit under and that deletion are `storage.ts` now.
 * What is left is three facts about the build, which is what the word means.
 *
 * ## Why it is still last
 *
 * The order runs from what she does with the world outside this window, through
 * what the window itself is, to what the build is — and a version number is the
 * one thing here nobody arrives looking for.
 */
import { element } from '../../element'
import { type Pane } from '../pane'
import { forPronoun, label as paneLabel } from '@shared/pronoun'
import { SAYS } from '../panes-says'
import { anchor, field, type Field, type PaneHandlers } from '../pane'
import { section } from '../../history/sheet/row'
import { type SettingsUpdate, type SettingsView } from '@shared/ipc'
import { AUTHOR, SITE, SOURCE, VERSION, glyphSvg, type Glyph } from '../../history/glyph'
import { type Link } from '@shared/links'

/**
 * What this group holds, named once. See `Field`.
 *
 * Four, and the first three are not settings. That is deliberate: this is the
 * group somebody lands on when they cannot find something, and the things they
 * arrive for — the version to quote in an issue, the button that updates, the
 * address of the source — are facts and acts rather than controls. A search that
 * indexed only what can be CHANGED would miss every one of them.
 */
const FIELDS: Readonly<Record<'build' | 'links' | 'updates' | 'builtOn', Field>> = {
  build: {
    id: 'build',
    label: 'Build',
    keywords: ['version', 'architecture', 'arm64', 'intel', 'electron', 'which build'],
  },
  links: {
    id: 'links',
    label: 'Author, source and website',
    keywords: ['github', 'repository', 'licence', 'license', 'homepage', 'issue', 'version'],
  },
  updates: {
    id: 'updates',
    label: 'Updates',
    keywords: ['upgrade', 'newer', 'download', 'check for updates', 'install'],
  },
  builtOn: {
    id: 'built-on',
    label: 'What it is built on',
    keywords: ['dependencies', 'sqlite', 'fonts', 'typefaces', 'licences', 'licenses'],
  },
}

export const ABOUT: Pane = {
  id: 'about',
  label: 'About',
  attention: () => null,
  fields: () => [FIELDS.build, FIELDS.links, FIELDS.updates, FIELDS.builtOn],
  render(view, handlers) {
    /*
      THE BUILD, AS ONE LINE — B7's `0.0.1 · arm64 · electron 33`.

      It was two label-beside-value rows, "Application · Mochi 0.1.2" and
      "Electron · 43.3.0", which spends two rows and two labels on three facts
      that are one fact: which build this is. The architecture was not on screen
      at all, and it is the one a bug report needs that the version does not
      carry — the same version on the wrong architecture runs under translation,
      and nothing else here says so.

      The Electron version is cut to its major. `43.3.0` is a number nobody can
      act on; `electron 43` is the one people quote.
    */
    const build = anchor(FIELDS.build, element('div', 'build'))
    build.append(
      element('div', 'build-name', view.about.name),
      element(
        'div',
        'build-facts',
        `${view.about.version} \u00b7 ${view.about.arch} \u00b7 electron ${
          view.about.electron.split('.')[0] ?? view.about.electron
        }`,
      ),
    )
    return [
      build,
      /*
        WHERE TO FIND THE PROJECT, and which build you are holding.

        Four facts that a person goes looking for and that were on no screen:
        who made it, where the source is, where the site is, and the version —
        the last of which was only in the build line above, run together with
        the architecture and the Electron major, where it reads as diagnostics
        rather than as the number you quote in an issue.

        The first three OPEN; the fourth does not, and it is drawn as a row
        anyway so the version sits with the other three rather than being the
        one fact you have to hunt for somewhere else.
      */
      links(handlers, view.about.version),
      updates(view.update, view.pronoun, handlers),
      /*
        WHAT IT IS BUILT ON, which was on no screen.

        B7 draws it and the reason is in the last line: zero runtime
        dependencies is a choice, not an accident, and a page that says nothing
        about what it stands on cannot make that claim checkable. Everything
        here is a fact about this repository — the versions are the ones the
        build reports, and `node:sqlite` has no version of its own because it is
        part of the runtime.
      */
      field(FIELDS.builtOn, view, builtOn(view.about.electron), {
        note: forPronoun(SAYS.typefaces, view.pronoun),
      }),
      // Where the rest of her went, said once, here — because this is the group
      // somebody lands on when they cannot find something.
      element('p', 'note', forPronoun(SAYS.whoSheIs, view.pronoun)),
    ]
  },
}

/**
 * The four things this build stands on, and the claim that there is nothing
 * else.
 *
 * The last row is the point: it states the TOTAL, which is what makes the other
 * three worth listing. A list of what a program depends on that omits the total
 * is a list you cannot conclude anything from.
 *
 * It read "none — zero runtime dependencies" until `electron-updater` was
 * added, and the claim came out with the same commit that made it false. That
 * is the whole value of stating a total on screen: it cannot quietly survive
 * the change that breaks it. The count is `dependencies` plus everything they
 * pull in, which is the number that actually ships.
 *
 * Electron's version comes from the running process; the rest are properties of
 * the repository and are written here, beside the sentence that reads them.
 */
function builtOn(electron: string): HTMLElement {
  const table = element('div', 'built-on')
  for (const [what, detail] of [
    ['Electron', `${electron} · MIT`],
    ['node:sqlite', 'part of the runtime — no package of its own'],
    ['Outfit', 'SIL OFL 1.1 · bundled'],
    ['JetBrains Mono', 'SIL OFL 1.1 · bundled'],
    ['electron-updater', 'MIT · the only runtime dependency, and what it pulls in'],
    ['everything else', 'none — nothing else is bundled'],
  ] as const) {
    const row = element('div', 'built-row')
    row.append(element('span', 'built-what', what), element('span', 'built-detail', detail))
    table.append(row)
  }
  return table
}

/**
 * The three addresses and the version, as four rows with a glyph each.
 *
 * ## The icon never carries the meaning
 *
 * Every row says its own words. The glyph is a scanning aid beside them, which
 * is the rule the microphone mark in the top strip states — an icon alone *"is
 * only a statement to somebody already looking at it"*. So `aria-hidden` on the
 * graphic, and nothing here relies on recognising a picture.
 *
 * ## Buttons, not anchors
 *
 * An `<a href>` in a renderer navigates the window, and this window is the
 * application. The three that open are `<button>`s that name a KIND, and main
 * resolves it — see `settings:open-link`. Lucide ships no GitHub mark, so the
 * source row wears `git-branch` and says where it goes in words.
 */
function links(handlers: PaneHandlers, version: string): HTMLElement {
  const list = anchor(FIELDS.links, element('div', 'about-links'))
  const rows: readonly [Glyph, string, string, Link | null][] = [
    [AUTHOR, 'Author', '@xiaolai · lixiaolai.com', 'author'],
    [SOURCE, 'Source', 'github.com/xiaolai/mochi', 'repo'],
    [SITE, 'Website', 'moch.im', 'site'],
    [VERSION, 'Version', version, null],
  ]
  for (const [glyph, what, said, opens] of rows) {
    const row = element(opens === null ? 'div' : 'button', 'about-link')
    if (opens !== null) {
      const button = row as HTMLButtonElement
      button.type = 'button'
      // The words, not "link" — a row announced as its address is a row
      // somebody can act on without seeing the glyph beside it.
      button.setAttribute('aria-label', `${what}: ${said}. Opens in your browser.`)
      /*
        The kind, on the element as well as in the closure.
        
        Not decoration and not for CSS: it is how the rendered gate can assert
        that Website opens the site and Source opens the repository without
        pressing anything. Pressing for real opens a browser, and a check that
        opens three tabs on whoever runs it is a check people disable.
        
        It is the SAME `opens` the handler below closes over, so the attribute
        cannot drift from the behaviour — one value, read twice.
      */
      button.dataset['opens'] = opens
      button.addEventListener('click', () => {
        handlers.openLink(opens)
      })
    }
    row.append(
      glyphSvg(glyph, 15),
      element('span', 'about-what', what),
      element('span', 'about-said', said),
    )
    list.append(row)
  }
  return list
}

/**
 * Whether there is a newer build, and the one press that moves it along.
 *
 * ## One control, three meanings
 *
 * Look, fetch, restart. They are three different acts with three different
 * costs — a request, a 120MB download, and replacing the running application —
 * and putting three buttons on screen would ask somebody to choose between
 * verbs when only one of them is ever available. The button says what it will
 * do next, and what it will do next is decided by what the last one found.
 *
 * ## Nothing happens on its own
 *
 * `update.ts` turns off `autoDownload` and `autoInstallOnAppQuit`. She sits on
 * a desktop all day; fetching 120MB unasked, on a connection that may be
 * metered, and then replacing herself at the next quit are two things nobody
 * agreed to. So this row does nothing at all until it is pressed.
 */
function updates(
  state: SettingsUpdate,
  pronoun: SettingsView['pronoun'],
  handlers: PaneHandlers,
): HTMLElement {
  const said: Record<SettingsUpdate['kind'], string> = {
    unsupported: 'Only a packaged build can update itself — this one is running from source.',
    idle: 'Not checked yet.',
    none: 'This is the newest build.',
    available: 'A newer build is out.',
    ready: 'Downloaded. It replaces this one when you restart.',
    failed: 'Could not check.',
  }
  const note = element('p', 'note', said[state.kind])
  if (state.kind === 'failed') note.textContent = `Could not check — ${state.why}`
  if (state.kind === 'available') note.textContent = `${state.version} is out.`

  const press = element('button', 'btn')
  press.type = 'button'
  const act: { label: string; run: () => void } | null =
    state.kind === 'unsupported'
      ? null
      : state.kind === 'available'
        ? {
            label: `Download ${state.version}`,
            run: () => {
              press.disabled = true
              press.textContent = 'Downloading…'
              void handlers.downloadUpdate()
            },
          }
        : state.kind === 'ready'
          ? {
              label: `Restart and install ${state.version}`,
              run: () => {
                handlers.installUpdate()
              },
            }
          : {
              label: 'Check for updates',
              run: () => {
                press.disabled = true
                press.textContent = 'Checking…'
                void handlers.checkUpdate()
              },
            }

  const body: HTMLElement[] = [note]
  if (act !== null) {
    press.textContent = act.label
    press.addEventListener('click', act.run)
    body.push(press)
  }
  const wrap = element('div', 'about-updates')
  wrap.append(...body)
  /*
    THE HEADING COMES FROM THE DECLARATION, not from a literal beside it.

    It was `section('Updates', …)` written two lines from `FIELDS.updates.label`,
    which is exactly the drift the declaration exists to stop: rename the field
    and the search result says one thing while the heading it scrolls to says
    another. Read through `paneLabel` because a label may be a `ByPronoun` table
    — this one is not, and going through the helper keeps that a property of the
    data rather than of this call site.
  */
  return anchor(
    FIELDS.updates,
    section(
      paneLabel(FIELDS.updates.label, pronoun),
      state.kind === 'none' ? 'up to date' : '',
      wrap,
    ),
  )
}
