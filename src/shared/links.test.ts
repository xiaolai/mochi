import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LINKS, LINK_KINDS, isLink } from './links'

/**
 * Each of the three is checked against the file it was copied from.
 *
 * `links.ts` states them rather than deriving them, for reasons it gives: two
 * are in `package.json` in a shape a browser will not take, and the third is in
 * a file that is not bundled. A stated copy is fine; a stated copy nobody
 * checks is how a link comes to point at a domain somebody stopped paying for.
 */
const root = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

describe('the three addresses, against their sources', () => {
  it('repo is the manifest’s repository, made browsable', () => {
    const manifest = JSON.parse(root('package.json'))
    // `git+https://github.com/xiaolai/mochi.git` is what npm wants and what a
    // browser will not take. Both cuts are asserted rather than assumed.
    const browsable = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
    expect(LINKS.repo).toBe(browsable)
  })

  it('author is the manifest’s homepage', () => {
    expect(LINKS.author).toBe(JSON.parse(root('package.json')).homepage)
  })

  it('site is the domain the website actually publishes at', () => {
    // The same file `pages.yml` compares against before it deploys, so this and
    // the deploy cannot disagree about where the site lives.
    expect(LINKS.site).toBe(`https://${root('site/CNAME').trim()}`)
  })
})

describe('what may be opened', () => {
  it('is exactly three kinds', () => {
    expect([...LINK_KINDS].sort()).toEqual(['author', 'repo', 'site'])
  })

  it('accepts only those, so a value off the wire cannot name a fourth', () => {
    for (const kind of LINK_KINDS) expect(isLink(kind)).toBe(true)
    for (const no of ['', 'Repo', 'file:///etc/passwd', 'https://example.com', null, 7, {}]) {
      expect(isLink(no)).toBe(false)
    }
  })

  it('every one is https, because `openExternal` will open anything', () => {
    for (const url of Object.values(LINKS)) expect(url.startsWith('https://')).toBe(true)
  })
})
