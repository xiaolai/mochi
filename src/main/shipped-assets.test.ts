import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every file this app ships is a file something reaches for.
 *
 * ## The failure it exists for, which had already happened
 *
 * `resources/icons/dock.png` sat in this repository from the beginning. It was
 * copied into the bundle by `extraResources`, and `shipped-icons.test.ts`
 * measured it against the rig that draws her — an asset verified against the
 * artwork, shipped to every user, and read by nothing at all. The Dock tile
 * showed Electron's own logo the whole time.
 *
 * That is the shape this repository keeps finding: something that looks
 * finished from every angle except the one nobody checked. A green test on the
 * artwork made it worse rather than better, because the file was demonstrably
 * *correct* — nobody thought to ask whether it was *used*.
 *
 * ## Why a source grep, and what it cannot see
 *
 * The relationship being checked is between a folder and a program, and no unit
 * of either can observe it. So this reads the source as text, which is the
 * technique `lifecycle.test.ts` and `stylesheets.test.ts` already use here for
 * exactly that reason.
 *
 * Two consumers do not name their files literally, and both are listed below
 * with the convention that reaches them rather than waved through. An
 * allowlist somebody has to WRITE A REASON INTO is the point: an unused asset
 * stops being invisible and becomes a line that says it is unused.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function read(relative: string): string {
  return readFileSync(ROOT + relative, 'utf8')
}

/** Every file under `resources/`, as `folder/file.png`. */
function shipped(): readonly string[] {
  const found: string[] = []
  for (const folder of readdirSync(ROOT + 'resources')) {
    for (const file of readdirSync(`${ROOT}resources/${folder}`)) found.push(`${folder}/${file}`)
  }
  return found
}

/** Every source file that could name one, plus the packaging config. */
function everySourceText(): string {
  const texts: string[] = [read('electron-builder.yml')]
  const walk = (directory: string): void => {
    for (const entry of readdirSync(ROOT + directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      // Tests are not consumers. `shipped-icons.test.ts` names two of these
      // files in its own prose, and counting that as a use is how `dock.png`
      // could have gone on looking wired for another year.
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
      texts.push(readFileSync(ROOT + path, 'utf8'))
    }
  }
  walk('src')
  return texts.join('\n')
}

/**
 * Reached by a name the source computes rather than writes.
 *
 * Each entry states the mechanism. Anything that cannot be given one belongs in
 * the failure list, not here.
 */
const BY_CONVENTION: readonly { readonly test: RegExp; readonly because: string }[] = [
  {
    // `tray.png` and `trayTemplate.png` are named in `iconFileFor`; macOS
    // resolves `@2x` and `@3x` from the base path without either being written.
    test: /^tray\/tray(Template)?@[23]x\.png$/,
    because: 'macOS resolves @2x and @3x from the base name `tray.ts` does write',
  },
  {
    // `withWindowsScales` builds these from the `-16` base with
    // `base.replace('-16.png', `-${size}.png`)`, over `WINDOWS_SCALES`.
    test: /^tray\/trayWin-on(Dark|Light)-\d+\.png$/,
    because: '`withWindowsScales` derives them from the -16 base over WINDOWS_SCALES',
  },
  {
    // `linux.icon` points at the DIRECTORY; electron-builder picks up every
    // `NxN.png` in it by convention. Only the 1024 is named, for `mac.icon`.
    test: /^icons\/\d+x\d+\.png$/,
    because: 'electron-builder reads the whole directory for `linux.icon`',
  },
  {
    /*
      NOT USED, and said here rather than left to be discovered.

      Drawn for a Windows taskbar at 100% and 200%, which needs a multi-size
      `.ico` — `BrowserWindow.icon` takes one path, and `windowIcon` gives it the
      256. Kept as artwork rather than deleted, because the drawing is right and
      the packaging is what is missing.
    */
    test: /^icons\/window-(32|64)\.png$/,
    because: 'artwork for a multi-size Windows .ico this build does not produce yet',
  },
]

describe('every shipped asset has something that reaches it', () => {
  const source = everySourceText()
  const assets = shipped()

  it('has assets to check, and knows the one that was not wired', () => {
    // Non-vacuous by construction. An extraction that silently stopped matching
    // would report a clean sweep, which reads exactly like a passing test.
    expect(assets.length).toBeGreaterThan(0)
    expect(assets).toContain('icons/dock.png')
  })

  it.each(shipped())('%s', (asset) => {
    const file = asset.split('/')[1] ?? ''
    const named = source.includes(file)
    const convention = BY_CONVENTION.find((one) => one.test.test(asset))
    expect(
      named || convention !== undefined,
      `${asset} is shipped and nothing reads it. Wire it, delete it, or add it to ` +
        `BY_CONVENTION with the reason it is there.`,
    ).toBe(true)
  })

  it('reaches the two icons this app sets at RUNTIME, by name', () => {
    /*
      The pair the general check above could not have caught on its own: both
      were matched by no convention and named by no source, and one of them —
      `dock.png` — is the reason this file exists. Named explicitly so that
      moving either into `BY_CONVENTION` takes a deliberate edit here rather
      than quietly satisfying a regex written for something else.
    */
    const window = read('src/main/window.ts')
    expect(window).toContain('dock.png')
    expect(window).toContain('window-256.png')
    expect(window).toContain('app.dock?.setIcon')
  })
})
