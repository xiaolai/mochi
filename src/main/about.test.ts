import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { about, openableUrls } from './about'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as {
  productName: string
  version: string
  author: string
  repository: { url: string }
}

describe('what the About group reports', () => {
  it('comes from package.json rather than from a second copy', () => {
    // The failure this prevents is an About box confidently reporting last
    // year's version, because the release step bumped the manifest and nobody
    // remembered the constant beside it.
    const shown = about()
    expect(shown.name).toBe(manifest.productName)
    expect(shown.version).toBe(manifest.version)
    expect(shown.author).toBe(manifest.author)
  })

  it('turns the clone URL into one a browser can open', () => {
    // npm's conventional value is `git+https://….git`, which is right for a
    // clone and wrong for a person: `git+https` is a scheme the OS has nothing
    // registered for, so the shell declines it and the button does nothing.
    expect(manifest.repository.url).toMatch(/^git\+/)
    expect(about().repository).toBe('https://github.com/xiaolai/mochi')
    expect(about().repository).not.toContain('git+')
    expect(about().repository.endsWith('.git')).toBe(false)
  })
})

describe('the addresses this app will open', () => {
  it('is exactly the two the About group shows', () => {
    const allowed = openableUrls()
    expect([...allowed].sort()).toEqual(
      ['https://github.com/xiaolai/mochi', 'https://lixiaolai.com'].sort(),
    )
  })

  it('refuses everything else, including near misses', () => {
    // `shell.openExternal` hands the string to the OS, which launches whatever
    // is registered for the scheme -- so this set is a security boundary, not a
    // convenience. The near misses matter more than the obvious ones: a
    // prefix check or a hostname check would let every line below through.
    const allowed = openableUrls()
    const refused = [
      'https://github.com/xiaolai/mochi/settings',
      'https://github.com/someone-else/mochi',
      'https://github.com.evil.example/xiaolai/mochi',
      'https://lixiaolai.com.evil.example',
      'http://lixiaolai.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      // The one that motivates an allowlist over a validator: on macOS this
      // asks the OS to run a shortcut, and no URL parser calls it malformed.
      'shortcuts://run-shortcut?name=wipe',
      '',
    ]
    for (const url of refused) expect(allowed.has(url), url).toBe(false)
  })

  it('holds only https addresses', () => {
    for (const url of openableUrls()) expect(url.startsWith('https://'), url).toBe(true)
  })
})
