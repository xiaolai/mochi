import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isProfileName } from '../../main/store/worn'
import { codexHome, profileFile, profileFor, seedProfile, SEEDED_PROFILE } from './profile'

/**
 * Writing into a directory another application owns.
 *
 * Every assertion here is about restraint rather than function: what it does
 * NOT do to `$CODEX_HOME` is the part that matters, because the failure mode is
 * silently replacing configuration somebody wrote by hand.
 */

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mochi-codexhome-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('finding Codex home', () => {
  it('honours CODEX_HOME when it is set', () => {
    // Verified against codex-cli 0.148.0, which reads the variable in both
    // `exec` and `doctor`. Somebody who has moved it moved it for a reason, and
    // writing to the wrong place produces a file that is never read.
    expect(codexHome({ CODEX_HOME: '/elsewhere/codex' }, '/home/them')).toBe('/elsewhere/codex')
  })

  it('falls back to ~/.codex, and treats an empty variable as unset', () => {
    expect(codexHome({}, '/home/them')).toBe(join('/home/them', '.codex'))
    expect(codexHome({ CODEX_HOME: '' }, '/home/them')).toBe(join('/home/them', '.codex'))
  })
})

describe('seeding the profile', () => {
  it('writes it once, where Codex will look for it', () => {
    const seeded = seedProfile(root, existsSync)
    expect(seeded.kind).toBe('written')
    expect(seeded.path).toBe(join(root, `${SEEDED_PROFILE}.config.toml`))
    expect(existsSync(seeded.path)).toBe(true)
  })

  it('NEVER overwrites one that is already there', () => {
    // Once it is on disk it is the user's, whatever is in it. `wx` rather than
    // an existence check, which would race — and rather than an unconditional
    // write, which would throw away somebody's edits on every launch.
    const path = profileFile(root, SEEDED_PROFILE)
    writeFileSync(path, 'model = "their-own-choice"\n')
    const seeded = seedProfile(root, existsSync)
    expect(seeded.kind).toBe('kept')
    expect(readFileSync(path, 'utf8')).toBe('model = "their-own-choice"\n')
  })

  it('does not create a Codex home that is not there', () => {
    // If the CLI has never run there is nothing to configure, and a
    // half-populated home for another application is not ours to make.
    const missing = join(root, 'never-ran')
    const seeded = seedProfile(missing, existsSync)
    expect(seeded.kind).toBe('no-codex-home')
    expect(existsSync(missing)).toBe(false)
  })

  it('reports a write it could not do rather than throwing on the startup path', () => {
    // A file where the directory should be. She can still look things up — the
    // profile is how somebody CONFIGURES a lookup, not what makes one possible.
    const notADirectory = join(root, 'file-not-dir')
    writeFileSync(notADirectory, 'x')
    const seeded = seedProfile(notADirectory, existsSync)
    expect(seeded.kind).toBe('failed')
  })

  it('seeds something that changes nothing until it is edited', () => {
    // An invitation, not a default anybody has to undo. Every line is a comment,
    // so layering it cannot alter how somebody's lookups already behave.
    const seeded = seedProfile(root, existsSync)
    const body = readFileSync(seeded.path, 'utf8')
    const settings = body
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    expect(settings).toEqual([])
  })

  it('tells the truth about what cannot be changed from it', () => {
    // The avatars README told people to run `pnpm tuner`, a script this repo
    // does not have, until it was corrected. A file that lies is worse than one
    // that is missing, and this one is written into somebody else's config
    // directory.
    const body = readFileSync(seedProfile(root, existsSync).path, 'utf8')
    expect(body).toContain('project_doc_fallback_filenames')
    expect(body).toContain('read-only')
    // And what DOES still apply, which is the part somebody would otherwise
    // discover by surprise.
    expect(body).toContain('MCP')
    // The name in the file is the name actually passed to `-p`.
    expect(body).toContain(`-p ${SEEDED_PROFILE}`)
  })

  it('seeds a name that is a legal profile name', () => {
    // It becomes a filename inside `$CODEX_HOME`. A seeded name that its own
    // grammar rejects would be a setting nobody could re-enter by hand.
    expect(isProfileName(SEEDED_PROFILE)).toBe(true)
  })
})

describe('choosing which profile to layer', () => {
  it('uses the seeded one once its file is on disk', () => {
    // What makes the seeded file's own first claim true — that lookups run
    // with `-p mochi`. Without this it would describe something that never
    // happened, which is the failure the avatars README is still committing.
    expect(profileFor(root, null, existsSync)).toBeNull()
    seedProfile(root, existsSync)
    expect(profileFor(root, null, existsSync)).toBe(SEEDED_PROFILE)
  })

  it('falls back to nothing when the file is deleted, as the file promises', () => {
    // Checked rather than relying on the CLI. codex-cli 0.148.0 tolerates `-p`
    // naming a file that is not there, silently — but that is undocumented, and
    // resting the fallback on it would make the promise about a version rather
    // than about this code.
    seedProfile(root, existsSync)
    rmSync(profileFile(root, SEEDED_PROFILE))
    expect(profileFor(root, null, existsSync)).toBeNull()
  })

  it('lets an explicit choice win, whether or not we seeded anything', () => {
    seedProfile(root, existsSync)
    expect(profileFor(root, 'theirs', existsSync)).toBe('theirs')
  })
})
