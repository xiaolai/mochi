/**
 * The three addresses this application will open, and nothing else.
 *
 * ## Named by KIND, never by URL
 *
 * The renderer asks for `repo`; it does not hand main a string to open. That is
 * the same rule `settings:reveal` follows for folders, and the reason is
 * sharper here: `shell.openExternal` will open anything, including
 * `file://`, and a channel that takes a URL from the window is a channel that
 * opens whatever ends up in that window. There is no allowlist to get wrong
 * because there is no list at runtime — the three below are the whole surface.
 *
 * ## Why they are not read from `package.json`
 *
 * Two of them are in there, in a shape that is not a link: `repository.url` is
 * `git+https://…/mochi.git`, which has to have two pieces cut off it before a
 * browser will take it, and `homepage` is the author's site rather than the
 * application's. The third is in `site/CNAME`, which is not bundled at all.
 *
 * So they are stated here, and `links.test.ts` reads all three of those files
 * and fails if any has moved. Stating a value and checking it against its source
 * is what makes this a copy that cannot rot rather than a second truth.
 */
export const LINKS = {
  /** Who made it. `package.json`'s `homepage`, which is a person's site. */
  author: 'https://lixiaolai.com',
  /** The source. `package.json`'s `repository.url`, made browsable. */
  repo: 'https://github.com/xiaolai/mochi',
  /** The application's own site. `site/CNAME`, which `pages.yml` also asserts. */
  site: 'https://moch.im',
} as const

export type Link = keyof typeof LINKS

export const LINK_KINDS = Object.keys(LINKS) as readonly Link[]

/** Whether a value off the wire names one of the three. */
export function isLink(value: unknown): value is Link {
  return typeof value === 'string' && (LINK_KINDS as readonly string[]).includes(value)
}
