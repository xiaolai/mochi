/**
 * What the About group says, read from `package.json` rather than retyped.
 *
 * `package.json` is already the authoritative place for a name, a version, an
 * author and a repository — npm, electron-builder and every tool in the chain
 * read them from there. Restating any of them in a TypeScript constant creates
 * a second copy that no release step updates, and the failure is an About box
 * confidently reporting last year's version.
 *
 * Imported rather than read with `fs`: the bundler inlines it, so a packaged
 * app carries the values rather than needing the file to be findable at
 * runtime, and a missing field is a type error here rather than `undefined` on
 * screen.
 */

import manifest from '../../package.json' with { type: 'json' }

export interface About {
  /** The display name, which is not the npm package name. */
  readonly name: string
  readonly version: string
  /** Shown and openable. `https`, with the git decoration stripped. */
  readonly repository: string
  /** A handle, not a URL — shown as text, never linked. */
  readonly author: string
  readonly homepage: string
}

/**
 * Turn npm's repository field into a URL a person can be sent to.
 *
 * The conventional value is `git+https://…/repo.git`, which is correct for a
 * clone and wrong for a browser: the `git+` prefix makes it an unknown scheme
 * and the shell refuses it, silently.
 */
function browsable(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

export function about(): About {
  return {
    name: manifest.productName,
    version: manifest.version,
    repository: browsable(manifest.repository.url),
    author: manifest.author,
    homepage: manifest.homepage,
  }
}

/**
 * The only addresses this app will ever ask the OS to open.
 *
 * An allowlist, not a validator. `shell.openExternal` hands a string to the
 * operating system, which will launch whatever is registered for its scheme —
 * so "is this a safe URL" is not a question a regexp can answer, and the
 * renderer must not get to choose. The About group needs exactly two
 * destinations and they are both known at build time, so the honest shape is a
 * closed set rather than a check.
 */
export function openableUrls(): ReadonlySet<string> {
  const { repository, homepage } = about()
  // `author` is deliberately absent: it is a handle, not an address. Turning
  // `@xiaolai` into a URL would mean this module guessing which service the
  // handle belongs to, and guessing is how an allowlist grows a hole.
  return new Set([repository, homepage])
}
