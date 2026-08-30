import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * WHAT IS TURNED OFF, said out loud on every run.
 *
 * The v2 window is being rebuilt from the artboards rather than migrated, and
 * four suites hold v1's presentation conventions — its class vocabulary, its
 * token set, its id list, its call sites. They are excluded in
 * `vitest.config.ts` while that happens.
 *
 * An exclusion in a config is a thing nobody reads twice. This is the half that
 * makes it reversible: it asserts the config's list and the manifest in
 * `dev-docs/suspended-for-redesign.md` name the same files, so neither can grow,
 * shrink or rot without the other, and it prints the list every time the suite
 * runs so a green `pnpm verify` cannot quietly mean less than it used to.
 *
 * Delete this file when the last entry goes. Its whole purpose is to stop
 * existing.
 */
const root = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('the suites suspended for the redesign', () => {
  const config = root('../vitest.config.ts')
  const manifest = root('../dev-docs/suspended-for-redesign.md')

  /** The `exclude` array, read out of the config rather than restated here. */
  const excluded = [...(/exclude:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '').matchAll(/'([^']+)'/g)]
    .map((one) => one[1] ?? '')
    .filter((one) => one !== '')

  it('has something to report', () => {
    // If this fails the redesign is over and this file should be deleted, not
    // fixed. A zero-length list means every gate is back on.
    expect(excluded.length).toBeGreaterThan(0)
    console.log(
      `\n  ${String(excluded.length)} suites suspended for the redesign:\n` +
        excluded.map((one) => `    · ${one}`).join('\n') +
        '\n  see dev-docs/suspended-for-redesign.md\n',
    )
  })

  it.each(excluded.map((one) => [one]))('%s is named in the manifest', (file) => {
    expect(
      manifest,
      `${file} is excluded in vitest.config.ts and not explained in the manifest. ` +
        `A gate that is off for a reason nobody wrote down is a gate that stays off.`,
    ).toContain(file)
  })

  it('the manifest names nothing that is already back on', () => {
    // The other direction: an entry describing a suite that is running again is
    // a manifest that has stopped describing the build.
    const claimed = [...manifest.matchAll(/`(src\/[^`]+\.test\.ts)`/g)].map((one) => one[1] ?? '')
    for (const file of new Set(claimed)) {
      expect(excluded, `${file} is in the manifest but no longer excluded`).toContain(file)
    }
  })
})
