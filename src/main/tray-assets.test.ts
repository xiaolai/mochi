import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WINDOWS_SCALES, iconFileFor } from './tray'

/**
 * The tray asset each platform asks for, and whether it is actually there.
 *
 * `findings.md` §16, from a real Windows run: "The tray icon on Windows takes
 * the colour `tray.png` path, not the macOS template path. That path has never
 * been executed anywhere." It could not be — `iconFile` read `process.platform`
 * directly, so on a Mac the `win32` branch was unreachable and nothing could
 * check that the file it names even ships.
 *
 * The branch is a function of an argument now, so all three run here on every
 * platform, and every file any of them can name is checked for existence. That
 * is the failure worth catching from a Mac: a rename or a packaging slip leaves
 * an invisible tray icon, and §16's own note is blunt about the cost — "an
 * invisible tray icon is an app nobody can quit."
 *
 * ## What this still does not do
 *
 * It renders nothing. Whether Windows draws her correctly in a real
 * notification area, at a real DPI, on a real theme is unverified and stays
 * unverified; §16 says so and this does not change it. Selection and presence
 * are what a Mac can honestly check, and they are what it checks.
 */

const TRAY = fileURLToPath(new URL('../../resources/tray/', import.meta.url))

describe('which file each platform asks for', () => {
  it('takes the macOS template on darwin', () => {
    // Pure alpha, recoloured by the system for light and dark menu bars.
    expect(iconFileFor('darwin')).toBe('trayTemplate.png')
  })

  it('takes a coloured 16px base on win32', () => {
    expect(iconFileFor('win32')).toBe('trayWin-onDark-16.png')
  })

  it('takes the plain coloured variant everywhere else', () => {
    for (const other of ['linux', 'freebsd', 'openbsd'] as const) {
      expect(iconFileFor(other)).toBe('tray.png')
    }
  })

  it.each(['darwin', 'win32', 'linux'] as const)('%s asks for a file that exists', (platform) => {
    expect(existsSync(TRAY + iconFileFor(platform))).toBe(true)
  })
})

describe('the Windows renditions beside the 16px base', () => {
  it.each(WINDOWS_SCALES)('has the %spx rendition, for %sx scaling', (size) => {
    // `withWindowsScales` skips a missing rendition rather than throwing — the
    // right call at runtime, and exactly why the absence needs catching here
    // instead. A gap costs sharpness at one scale and says nothing about it.
    const file = iconFileFor('win32').replace('-16.png', `-${String(size)}.png`)
    expect(existsSync(TRAY + file), `${file} is missing`).toBe(true)
  })

  it('covers 125%, which is the default on a great many laptops', () => {
    expect(WINDOWS_SCALES.map(([, scale]) => scale)).toContain(1.25)
  })
})

describe('assets that ship and are asked for by nothing', () => {
  it('is the eight onLight renditions, and only those', () => {
    /*
      A real gap, pinned rather than hidden.

      `iconFileFor` returns `onDark` unconditionally on Windows: the taskbar
      theme query was deliberately not carried over from v1 — it shells out to
      `reg` for `SystemUsesLightTheme` and the subprocess helper it used does not
      exist in this tree — so the LIGHT half of the artwork is shipped by
      `extraResources` and selected by nothing.

      Naming them here does not fix it. It stops the set growing quietly, and it
      is where somebody wiring the theme query will find out this test needs to
      change.
    */
    const referenced = new Set(
      (['darwin', 'win32', 'linux'] as const).flatMap((platform) => {
        const base = iconFileFor(platform)
        return [base, ...WINDOWS_SCALES.map(([size]) => base.replace('-16.png', `-${size}.png`))]
      }),
    )
    // The macOS @2x/@3x are found by Electron from the 1x name, never named.
    const byConvention = /@[23]x\.png$/
    const orphans = readdirSync(TRAY)
      .filter((one) => one.endsWith('.png'))
      .filter((one) => !referenced.has(one) && !byConvention.test(one))
      .sort()
    expect(orphans).toEqual([
      'trayWin-onLight-16.png',
      'trayWin-onLight-20.png',
      'trayWin-onLight-24.png',
      'trayWin-onLight-28.png',
      'trayWin-onLight-32.png',
      'trayWin-onLight-36.png',
      'trayWin-onLight-40.png',
      'trayWin-onLight-48.png',
    ])
  })
})
