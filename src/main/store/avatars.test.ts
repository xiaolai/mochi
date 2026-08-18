import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MOCHI, parseFaceSpec } from '@shared/avatar-spec'
import {
  AVATARS_DIR,
  EXAMPLE_FILE,
  README_FILE,
  avatarsRoot,
  resolveAvatarById,
  seedAvatars,
} from './avatars'

// A real directory, not a mocked filesystem. The thing being tested is what
// happens to files somebody else wrote, and a mock would only confirm that the
// functions this test already believes in were called.
const dirs: string[] = []
function workspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-avatars-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const json = (face: Record<string, unknown>): string => JSON.stringify(face)

describe('resolveAvatarById', () => {
  it('falls back to the built-in when nothing is named', () => {
    const result = resolveAvatarById(workspace(), null)
    expect(result.face).toEqual(MOCHI)
    expect(result.source).toBeNull()
    // Naming no avatar is the ordinary state of an uncustomised persona, not
    // something to complain about.
    expect(result.problems).toHaveLength(0)
  })

  it('loads the avatar a persona names and says where it came from', () => {
    const mine = { ...MOCHI, name: 'blueberry', colBody: '#8aa8e8' }
    const root = workspace({ 'blueberry.json': json(mine) })
    const result = resolveAvatarById(root, 'blueberry')

    expect(result.source).toBe('blueberry.json')
    expect(result.face.colBody).toBe('#8aa8e8')
    // `name` is allowed in the file and does not survive into the face.
    expect('name' in result.face).toBe(false)
  })

  it('does not pick a different avatar when the named one is missing', () => {
    // The whole change from the old alphabetical resolver. Wearing whichever
    // file happened to sort first would mean a persona silently wears somebody
    // else's face, which looks like the app choosing for you.
    const root = workspace({ 'alpha.json': json({ ...MOCHI, colBody: '#222222' }) })
    const result = resolveAvatarById(root, 'blueberry')

    expect(result.face).toEqual(MOCHI)
    expect(result.source).toBeNull()
    expect(result.problems).toHaveLength(1)
  })

  it('reports a broken file by name rather than falling through', () => {
    const root = workspace({ 'blueberry.json': json({ ...MOCHI, bodyW: -5 }) })
    const result = resolveAvatarById(root, 'blueberry')

    expect(result.face).toEqual(MOCHI)
    expect(result.problems[0]!.file).toBe('blueberry.json')
    expect(result.problems[0]!.reason).toContain('bodyW')
  })

  it('reports malformed JSON by filename', () => {
    const result = resolveAvatarById(workspace({ 'oops.json': '{ not json' }), 'oops')
    expect(result.face).toEqual(MOCHI)
    expect(result.problems[0]!.file).toBe('oops.json')
    expect(result.problems[0]!.reason).toContain('JSON')
  })

  it('never returns an invalid face, whatever is on disk', () => {
    // The property the renderer depends on: it is handed a face it can draw,
    // or the built-in. There is no third outcome and no partial spec.
    for (const [id, body] of [
      ['a', '[]'],
      ['b', json({ waist: 4 })],
      ['c', 'null'],
    ] as const) {
      const result = resolveAvatarById(workspace({ [`${id}.json`]: body }), id)
      expect(result.face, id).toEqual(MOCHI)
      expect(result.problems, id).toHaveLength(1)
    }
  })

  it('refuses a name outside the grammar rather than joining it into a path', () => {
    // Every caller today passes an id `parsePersona` already checked -- which
    // is a property of today's callers, not of this function.
    for (const hostile of ['../../etc/passwd', 'a/b', 'Blueberry', 'con', 'blue.json']) {
      const result = resolveAvatarById(workspace(), hostile)
      expect(result.face, hostile).toEqual(MOCHI)
      expect(result.source, hostile).toBeNull()
      expect(result.problems.length, hostile).toBeGreaterThan(0)
    }
  })
})

describe('avatarsRoot', () => {
  it('sits inside userData', () => {
    // Compared against `join`, not against a POSIX literal. The separator is
    // the PLATFORM's, so hardcoding `/` asserted macOS rather than the
    // behaviour -- this failed on Windows with `\tmp\data\avatars`, which is
    // the correct answer there. Found by actually running the suite on
    // Windows; nothing on a Mac could have caught it.
    expect(avatarsRoot(join('tmp', 'data'))).toBe(join('tmp', 'data', AVATARS_DIR))
  })
})

describe('seedAvatars', () => {
  it('writes a folder somebody can find', () => {
    const root = join(workspace(), 'avatars')
    seedAvatars(root)
    expect(existsSync(join(root, EXAMPLE_FILE))).toBe(true)
    expect(existsSync(join(root, README_FILE))).toBe(true)
  })

  it('does not seed a face that would be loaded', () => {
    // `.example`, not `.json`. A shipped default the loader picks up makes the
    // built-in depend on a file being intact -- and the fallback for a broken
    // file IS the built-in, so that failure would have nothing to fall back to.
    const root = join(workspace(), 'avatars')
    seedAvatars(root)
    // Not loadable under any name: the stem of `mochi.json.example` is
    // `mochi.json`, which the id grammar refuses outright.
    expect(resolveAvatarById(root, 'mochi').source).toBeNull()
    expect(resolveAvatarById(root, 'mochi').face).toEqual(MOCHI)
  })

  it('REFRESHES the two files it ships, and only those', () => {
    // Changed deliberately, from "never overwrites anything". These two are
    // documentation, not user data: `README.txt` is prose we wrote and the
    // `.example` suffix says whose the other one is. The README told this
    // machine "the first valid one alphabetically wins" — behaviour the loader
    // has never had — and following it means dropping a file in, restarting,
    // and watching nothing happen with no error, because nothing is wrong.
    //
    // The example refreshing is worth as much: it is `{name, ...MOCHI}`
    // serialised, so a change to the built-in that did not reach it would ship
    // a template that disagrees with the thing it is a template of.
    const root = join(workspace(), 'avatars')
    mkdirSync(root)
    writeFileSync(join(root, EXAMPLE_FILE), 'stale, from an older build')
    seedAvatars(root)
    expect(readFileSync(join(root, EXAMPLE_FILE), 'utf8')).toContain('"bodyW"')
  })

  it('fills in a seed file that is missing, without touching the others', () => {
    // The old guard skipped everything if the FOLDER existed, so a run that
    // created the directory and then failed on the second write left the README
    // absent permanently -- the folder existed forever after, and nothing
    // retried. Per-file and exclusive means a partial failure self-heals.
    const root = join(workspace(), 'avatars')
    mkdirSync(root)
    writeFileSync(join(root, 'somebody-elses.json'), 'mine, do not touch')
    seedAvatars(root)
    expect(existsSync(join(root, README_FILE))).toBe(true)
    expect(existsSync(join(root, EXAMPLE_FILE))).toBe(true)
    // And somebody else's avatar is still theirs. The refresh above is for the
    // two files this project ships and nothing else in the folder.
    expect(readFileSync(join(root, 'somebody-elses.json'), 'utf8')).toBe('mine, do not touch')
  })

  it('is idempotent', () => {
    const root = join(workspace(), 'avatars')
    seedAvatars(root)
    const first = readFileSync(join(root, EXAMPLE_FILE), 'utf8')
    seedAvatars(root)
    expect(readFileSync(join(root, EXAMPLE_FILE), 'utf8')).toBe(first)
  })

  it('survives a root it cannot write', () => {
    // A read-only userData is not a reason she cannot come up.
    expect(() => seedAvatars('/proc/nope/avatars')).not.toThrow()
  })
})

describe('the real default walks the real plugin path', () => {
  it('the seeded example loads back as exactly the built-in', () => {
    // The weld. Every other test here builds a spec in memory; this one takes
    // the artifact the app actually writes, puts it where a user avatar goes,
    // and runs the whole chain -- read, JSON.parse, validate, resolve.
    //
    // Without it, "the built-in goes through the same path as a user avatar" is
    // a claim about a fallback constant rather than a fact about a file, and
    // the first person to write their own would be the one to find out.
    const root = join(workspace(), 'avatars')
    seedAvatars(root)
    renameSync(join(root, EXAMPLE_FILE), join(root, 'mochi.json'))

    // The round trip: the artifact `seedAvatars` writes really does
    // travel the whole chain -- read, JSON.parse, validate, resolve -- and
    // comes back as the built-in. Renamed to a valid STEM, because that is now
    // how a persona names one.
    const result = resolveAvatarById(root, 'mochi')
    expect(result.problems).toHaveLength(0)
    expect(result.source).toBe('mochi.json')
    expect(result.face).toEqual(MOCHI)
  })

  it('the built-in survives a JSON round trip unchanged', () => {
    // Every field has to be expressible in the format. A value that only exists
    // as a TypeScript const -- an Infinity, a -0, something non-enumerable --
    // would make the default undesignable by a user, which is the one thing
    // this format must never allow.
    const result = parseFaceSpec(JSON.parse(JSON.stringify(MOCHI)))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.face).toEqual(MOCHI)
  })
})

describe('the files we ship into the folder', () => {
  it('refreshes a stale README rather than leaving it lying', () => {
    // A v1-era README survived on disk claiming "the first valid one
    // alphabetically wins" — behaviour this code has never had. Somebody
    // following it drops a file in, restarts, and nothing happens, with no
    // error, because nothing is wrong. That cost real time before it was found.
    const root = join(workspace(), 'avatars')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, README_FILE), 'the first valid one alphabetically wins')

    seedAvatars(root)

    const now = readFileSync(join(root, README_FILE), 'utf8')
    expect(now).not.toContain('alphabetically')
    expect(now).toContain('FILENAME')
  })

  it('never touches a user’s own avatar', () => {
    // The refresh above is only for the two files this project ships. Somebody
    // else's work in this folder is theirs.
    const root = join(workspace(), 'avatars')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'mine.json'), '{"mine":true}')

    seedAvatars(root)

    expect(readFileSync(join(root, 'mine.json'), 'utf8')).toBe('{"mine":true}')
  })
})
