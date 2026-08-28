/**
 * The catalog, and the three ways it is allowed to refuse a file.
 *
 * These are the cases an audit named as undefined before any of this was
 * written: what a duplicate id does, whether storage may claim the built-in's
 * id, and whether migrating the legacy persona twice produces two personas.
 * Each one is a data-loss question rather than a tidiness question, which is
 * why they are tested rather than commented.
 */

import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  renameSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTranscripts, type Transcripts } from './transcripts'
import { policyState, writePolicy } from './policy'
import { DEFAULT_POLICY } from '@shared/policy'
import { PACKAGE_FACE } from './avatars'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { BUILT_IN_ID } from '@shared/parse-persona'
import { activePersona, copyPersonaTo, loadPersonas, hasOwnFace, savePersonaTo } from './personas'
import { MANIFEST, personasRoot } from './persona-files'
import { EDITS, builtInPersona, type PersonaEdits } from './her-edits'
import { deletePersona, discardWrite, sweepDeletions } from './delete-persona'
import { editsFrom, readEdits, restoreBuiltIn } from './her-edits'

const roots: string[] = []

/**
 * A real transcript store for the delete path.
 *
 * `deletePersona` takes one because forgetting her conversations is not
 * optional -- see the comment there. A stub would let this suite pass over the
 * defect the parameter exists to prevent, so the tests use the store itself.
 */
const stores: Transcripts[] = []
let history: Transcripts

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-personas-'))
  roots.push(dir)
  return dir
}

beforeEach(() => {
  history = createTranscripts(mkdtempSync(join(tmpdir(), 'mochi-history-')))
  stores.push(history)
})

afterEach(() => {
  for (const store of stores) store.close()
  stores.length = 0
  roots.length = 0
})

const tutor: Persona = {
  ...DEFAULT_PERSONA,
  id: 'tutor',
  name: 'Ada',
  pronoun: 'it',
  theme: 'sky',
}

/** Write a persona PACKAGE: a folder holding a manifest. */
function write(userData: string, folder: string, value: unknown): void {
  mkdirSync(join(personasRoot(userData), folder), { recursive: true })
  writeFileSync(join(personasRoot(userData), folder, MANIFEST), JSON.stringify(value, null, 2))
}

describe('the built-in is in the catalog and never on disk', () => {
  it('is present with no folder at all', () => {
    const catalog = loadPersonas(workspace(), {})
    expect([...catalog.personas.keys()]).toEqual([BUILT_IN_ID])
    // No source, which is how "this one cannot be written to" is expressed --
    // a missing key rather than a flag somebody has to remember to check.
    expect(catalog.sources.has(BUILT_IN_ID)).toBe(false)
    expect(catalog.problems).toEqual([])
  })

  it('refuses a file that tries to claim her id, and keeps her', () => {
    const dir = workspace()
    write(dir, 'impostor', { ...tutor, id: BUILT_IN_ID })
    const catalog = loadPersonas(dir, {})

    expect(catalog.problems).toEqual([{ kind: 'reserved-id', id: BUILT_IN_ID, source: 'impostor' }])
    // The built-in she is, not the file's version of her.
    expect(catalog.personas.get(BUILT_IN_ID)).toEqual(DEFAULT_PERSONA)
  })
})

describe('a duplicate id takes down its own group and nothing else', () => {
  it('refuses every member and names every source', () => {
    const dir = workspace()
    write(dir, 'a', tutor)
    write(dir, 'b', { ...tutor, name: 'Grace' })
    write(dir, 'c', { ...tutor, id: 'coach', name: 'Coach' })

    const catalog = loadPersonas(dir, {})

    // Neither duplicate wins. Picking one would make the choice depend on
    // filesystem order -- and the loser's memory is filed under the same id.
    expect(catalog.personas.has('tutor')).toBe(false)
    expect(catalog.problems).toEqual([{ kind: 'duplicate-id', id: 'tutor', sources: ['a', 'b'] }])
    // The unrelated persona is untouched: one person's copy-paste must not
    // read as "all my personas vanished".
    expect(catalog.personas.get('coach')?.name).toBe('Coach')
    expect(catalog.sources.get('coach')).toBe('c')
  })
})

describe('a file that is not a persona is reported, not skipped in silence', () => {
  it('separates unreadable JSON from an invalid persona, and keeps going', () => {
    const dir = workspace()
    mkdirSync(join(personasRoot(dir), 'broken'), { recursive: true })
    writeFileSync(join(personasRoot(dir), 'broken', MANIFEST), '{ not json')
    write(dir, 'wrong', { ...tutor, id: 'Bad Id' })
    write(dir, 'good', { ...tutor, id: 'coach' })

    const catalog = loadPersonas(dir, {})

    expect(catalog.problems).toContainEqual({ kind: 'malformed', source: 'broken' })
    const invalid = catalog.problems.find((p) => p.kind === 'invalid')
    expect(invalid).toBeDefined()
    if (invalid?.kind === 'invalid') {
      expect(invalid.source).toBe('wrong')
      // The FIELD-level reasons travel too, so the window can say which field.
      expect(invalid.problems).toContainEqual({
        kind: 'field',
        field: 'id',
        reason: 'malformed',
      })
    }
    // Every file is examined even after a failure -- stopping early leaves a
    // broken persona permanently silent.
    expect(catalog.personas.has('coach')).toBe(true)
  })
})

describe('which persona is active', () => {
  it('falls back to the built-in and says so when the id is gone', () => {
    const catalog = loadPersonas(workspace(), {})
    const resolved = activePersona(catalog, 'deleted-one')
    expect(resolved.persona).toEqual(DEFAULT_PERSONA)
    expect(resolved.problem).toEqual({ kind: 'active-missing', id: 'deleted-one' })
  })

  it('says nothing when nobody has chosen one', () => {
    // Never having picked is not a problem, and reporting it identically to
    // "your persona is missing" is how a working setup grows a warning.
    const resolved = activePersona(loadPersonas(workspace(), {}), null)
    expect(resolved.persona).toEqual(DEFAULT_PERSONA)
    expect(resolved.problem).toBeNull()
  })

  /**
   * The built-in wears whatever this install made of her.
   *
   * `activePersona` used to return the module constant for her, which is also
   * what it returns when the remembered id is MISSING -- so reading her from
   * the wrong place would have looked exactly like the fallback path, and an
   * edit that never appeared reads as "editing does not work" rather than as
   * a lookup nobody made.
   */
  it('hands back the built-in wearing the edits this install made', () => {
    const catalog = loadPersonas(workspace(), { name: 'Bao', theme: 'sky', voice: 'verse' })
    for (const id of [null, BUILT_IN_ID]) {
      const resolved = activePersona(catalog, id)
      expect(resolved.persona.name, `active id ${String(id)}`).toBe('Bao')
      expect(resolved.persona.theme).toBe('sky')
      expect(resolved.persona.voice).toBe('verse')
      // Edited, not replaced. Her id keys her memory and her transcripts, so
      // a rename that changed who she is would quietly orphan both.
      expect(resolved.persona.id).toBe(BUILT_IN_ID)
      expect(resolved.problem).toBeNull()
    }
  })

  it('keeps the fields nobody touched at whatever the app now ships', () => {
    // The whole reason the overlay stores a DIFF. Somebody who renamed her two
    // releases ago still gets this release's prompt; a stored full manifest
    // would have frozen her at the version that was open when they typed.
    const resolved = activePersona(loadPersonas(workspace(), { name: 'Bao' }), null)
    expect(resolved.persona.style).toBe(DEFAULT_PERSONA.style)
    expect(resolved.persona.greeting).toEqual(DEFAULT_PERSONA.greeting)
  })

  it('editing her adds no persona to the folder', () => {
    // The defect this replaced: editing the built-in forked her into an
    // identically-named copy, so the shelf grew a second "Mochi" and there was
    // no route back to the first. The catalog stays one entry long.
    const dir = workspace()
    expect([...loadPersonas(dir, {}).personas.keys()]).toEqual([BUILT_IN_ID])
    expect([
      ...loadPersonas(dir, { name: 'Bao', style: 'Teach me words.' }).personas.keys(),
    ]).toEqual([BUILT_IN_ID])
  })
})

describe('the built-in is edited in place, and can be put back', () => {
  /** Read her back the way the app does: save, then reload through the overlay. */
  function reload(dir: string): Persona {
    return activePersona(loadPersonas(dir, readEdits(dir).edits), null).persona
  }

  it('survives a save and a reload', () => {
    const dir = workspace()
    savePersonaTo(dir, loadPersonas(dir, {}), {
      ...DEFAULT_PERSONA,
      name: 'Bao',
      style: 'You teach vocabulary.',
      voice: 'verse',
    })
    const her = reload(dir)
    expect([her.name, her.style, her.voice]).toEqual(['Bao', 'You teach vocabulary.', 'verse'])
    expect(her.id).toBe(BUILT_IN_ID)
  })

  it('writes only what differs, so the rest can still move with the app', () => {
    const dir = workspace()
    savePersonaTo(dir, loadPersonas(dir, {}), { ...DEFAULT_PERSONA, name: 'Bao' })
    const written = JSON.parse(
      readFileSync(join(personasRoot(dir), BUILT_IN_ID, EDITS), 'utf8'),
    ) as Record<string, unknown>
    // Exactly one key. A full manifest here would freeze every other field at
    // this release, which is the thing the diff format exists to prevent -- and
    // it would do it silently, since a frozen prompt still works.
    expect(Object.keys(written)).toEqual(['name'])
  })

  it('writes no manifest for her, so nothing can claim her id', () => {
    const dir = workspace()
    savePersonaTo(dir, loadPersonas(dir, {}), { ...DEFAULT_PERSONA, name: 'Bao' })
    expect(existsSync(join(personasRoot(dir), BUILT_IN_ID, MANIFEST))).toBe(false)
    // And she is still not a writable source: `sources` having no entry for her
    // is how the rest of the module reads "constant, not record".
    expect(loadPersonas(dir, readEdits(dir).edits).sources.has(BUILT_IN_ID)).toBe(false)
  })

  it('editing her back by hand leaves no overlay behind', () => {
    // "She is the original" and "somebody typed the original back" are the same
    // state. An empty `{}` left on disk would make the restore below look like
    // it had failed, and would light the undo button with nothing to undo.
    const dir = workspace()
    savePersonaTo(dir, loadPersonas(dir, {}), { ...DEFAULT_PERSONA, name: 'Bao' })
    savePersonaTo(dir, loadPersonas(dir, {}), DEFAULT_PERSONA)
    expect(existsSync(join(personasRoot(dir), BUILT_IN_ID, EDITS))).toBe(false)
    expect(editsFrom(reload(dir))).toEqual({})
  })

  it('restores her, and is harmless when there was nothing to restore', () => {
    const dir = workspace()
    savePersonaTo(dir, loadPersonas(dir, {}), {
      ...DEFAULT_PERSONA,
      name: 'Bao',
      theme: 'clay',
    })
    restoreBuiltIn(dir)
    expect(reload(dir)).toEqual(DEFAULT_PERSONA)
    // Idempotent: the button is offered from a snapshot that may be a moment
    // stale, so a second press must not throw at a file that is already gone.
    expect(() => {
      restoreBuiltIn(dir)
    }).not.toThrow()
  })

  it('ignores an overlay that would make her someone else', () => {
    const dir = workspace()
    mkdirSync(join(personasRoot(dir), BUILT_IN_ID), { recursive: true })
    writeFileSync(
      join(personasRoot(dir), BUILT_IN_ID, EDITS),
      JSON.stringify({ id: 'someone-else', name: 'Bao' }),
    )
    const her = activePersona(loadPersonas(dir, readEdits(dir).edits), null).persona
    // The name lands; the id cannot. Her id keys her memory and transcripts, so
    // an overlay able to set it would be a way to read another persona's notes.
    expect(her.name).toBe('Bao')
    expect(her.id).toBe(BUILT_IN_ID)
  })

  it('cannot be made into someone else, even by a caller that skips the filter', () => {
    // TWO guards, and this one reaches the inner. `readEdits` drops `id` and
    // `version` before they ever arrive, so a test that goes through it proves
    // only the outer -- and `builtInPersona` is exported, so the day something
    // hands it unfiltered edits, this is what holds. Her id keys her memory and
    // her transcripts; an overlay that could set it would be a way to read
    // another persona's notes.
    // Cast because the type already forbids these two keys -- which is the
    // first guard, and not the one under test. This reaches past it the way
    // a JSON file would.
    const her = builtInPersona({ name: 'Bao', id: 'someone-else', version: 99 } as PersonaEdits)
    expect(her.id).toBe(BUILT_IN_ID)
    expect(her.version).toBe(DEFAULT_PERSONA.version)
    expect(her.name).toBe('Bao')
  })

  it('keeps the edits it understands from an overlay a later build wrote', () => {
    // Moving between versions is ordinary, and `parsePersona` REFUSES unknown
    // fields -- so passing the file through unfiltered would make one key from
    // a newer build discard every edit the user made in it. The manifest is
    // refused for the opposite reason; an overlay is not a contract with
    // anybody, it is this user's own changes.
    const dir = workspace()
    mkdirSync(join(personasRoot(dir), BUILT_IN_ID), { recursive: true })
    writeFileSync(
      join(personasRoot(dir), BUILT_IN_ID, EDITS),
      JSON.stringify({ name: 'Bao', somethingTheNextReleaseAdded: 42 }),
    )
    const read = readEdits(dir)
    expect(read.problem).toBeNull()
    expect(read.edits).toEqual({ name: 'Bao' })
  })

  it('falls back to the original and says so when the overlay is unusable', () => {
    const dir = workspace()
    mkdirSync(join(personasRoot(dir), BUILT_IN_ID), { recursive: true })
    writeFileSync(join(personasRoot(dir), BUILT_IN_ID, EDITS), '{ not json')
    const read = readEdits(dir)
    expect(read.edits).toEqual({})
    expect(read.problem).not.toBeNull()
  })

  it('refuses an overlay whose merged result is not a persona', () => {
    // A fragment cannot be judged alone -- an overlay carrying only a greeting
    // is valid -- so the MERGED persona is what gets validated.
    const dir = workspace()
    mkdirSync(join(personasRoot(dir), BUILT_IN_ID), { recursive: true })
    writeFileSync(join(personasRoot(dir), BUILT_IN_ID, EDITS), JSON.stringify({ name: '' }))
    const read = readEdits(dir)
    expect(read.edits).toEqual({})
    expect(read.problem).not.toBeNull()
  })
})

describe('copying is the only thing that makes a new persona', () => {
  it('mints an id from the new name and leaves the original alone', () => {
    const dir = workspace()
    const { id } = copyPersonaTo(dir, loadPersonas(dir, {}), DEFAULT_PERSONA, 'Mochi 2')
    expect(id).toBe('mochi-2')
    const catalog = loadPersonas(dir, {})
    expect(catalog.personas.get(id)?.name).toBe('Mochi 2')
    // The built-in is untouched: copying her is not editing her.
    expect(catalog.personas.get(BUILT_IN_ID)).toEqual(DEFAULT_PERSONA)
  })

  it('copies the whole package, not just the manifest', () => {
    // "Add a copy" is the only authoring flow in the app -- no registry, no
    // install by URL. A copy that took only `persona.json` produced something
    // broken and SILENT: a persona whose prompt refers to a file that did not
    // come with her, handed nothing and saying nothing. Nothing errored.
    const dir = workspace()
    write(dir, 'coach', { ...tutor, id: 'coach', name: 'Coach' })
    writeFileSync(
      join(personasRoot(dir), 'coach', 'extra.json'),
      JSON.stringify({ anything: 'she needs' }),
    )
    const catalog = loadPersonas(dir, {})

    const { id } = copyPersonaTo(dir, catalog, catalog.personas.get('coach')!, 'Coach Two')

    expect(
      existsSync(join(personasRoot(dir), id, 'extra.json')),
      'the copy lost what made her work',
    ).toBe(true)
    // Taken by copying the FOLDER, so a file a later feature adds is carried
    // without anybody remembering to add a line here.
    writeFileSync(join(personasRoot(dir), 'coach', 'whatever-comes-next.json'), '{}')
    const { id: second } = copyPersonaTo(
      dir,
      loadPersonas(dir, {}),
      catalog.personas.get('coach')!,
      'Coach Three',
    )
    expect(existsSync(join(personasRoot(dir), second, 'whatever-comes-next.json'))).toBe(true)
  })

  it('does not copy the built-in overlay into a package', () => {
    // `edits.json` is this install's changes to the built-in. It is not part
    // of any package and handing it to somebody would ship your edits.
    const dir = workspace()
    write(dir, 'coach', { ...tutor, id: 'coach', name: 'Coach' })
    writeFileSync(join(personasRoot(dir), 'coach', EDITS), JSON.stringify({ name: 'Mine' }))
    const catalog = loadPersonas(dir, {})

    const { id } = copyPersonaTo(dir, catalog, catalog.personas.get('coach')!, 'Coach Two')
    expect(existsSync(join(personasRoot(dir), id, EDITS))).toBe(false)
  })

  it('refuses to write over a folder that is already there', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    // Present in the catalog, so `deriveId` avoids it -- this is the case where
    // a folder exists that the catalog does NOT know about, which is what the
    // no-clobber check is actually for.
    const bare = {
      personas: new Map(),
      sources: new Map(),
      problems: [],
      carriedPolicies: new Map(),
      reserved: new Set<string>(),
    }
    expect(() => copyPersonaTo(dir, bare, DEFAULT_PERSONA, 'Ada')).toThrow(/refusing to overwrite/)
  })
})

describe('saving', () => {
  it('overwrites a persona in the file it came from, whatever it is called', () => {
    const dir = workspace()
    // A filename that has nothing to do with the id, which is the case the
    // `sources` map exists for: deriving a path from the id would write a
    // second file and leave the first one shadowing it.
    write(dir, 'odd-filename', { ...tutor, id: 'teacher' })
    const catalog = loadPersonas(dir, {})

    const written = savePersonaTo(dir, catalog, {
      ...tutor,
      id: 'teacher',
      name: 'Ada Lovelace',
    })

    expect(written).toEqual({ id: 'teacher', source: 'odd-filename' })
    const reloaded = loadPersonas(dir, {})
    expect(reloaded.personas.get('teacher')?.name).toBe('Ada Lovelace')
    expect([...reloaded.personas.keys()].filter((id) => id !== BUILT_IN_ID)).toEqual(['teacher'])
  })

  it('writes the built-in in place, and mints nothing', () => {
    const dir = workspace()
    const catalog = loadPersonas(dir, {})

    const written = savePersonaTo(dir, catalog, { ...DEFAULT_PERSONA, name: 'Ada' })

    // This used to fork: her id was reserved, so renaming her produced a copy
    // called `ada` and moved the user onto it without saying so.
    expect(written.id).toBe(BUILT_IN_ID)
    const reloaded = loadPersonas(dir, readEdits(dir).edits)
    expect([...reloaded.personas.keys()]).toEqual([BUILT_IN_ID])
    expect(reloaded.personas.get(BUILT_IN_ID)?.name).toBe('Ada')
  })

  it('copies her onto a free id when the derived one is taken', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    const catalog = loadPersonas(dir, {})

    const written = copyPersonaTo(dir, catalog, DEFAULT_PERSONA, 'Ada')
    expect(written.id).toBe('ada-2')
    // The persona that already held the name is untouched.
    expect(loadPersonas(dir, {}).personas.get('ada')?.name).toBe('Ada')
  })
})

describe('resolveAvatarById validates its own input', () => {
  it('refuses an id outside the grammar rather than joining it into a path', async () => {
    const { resolveAvatarById } = await import('./avatars')
    // Every caller today passes an id parsePersona already checked -- which is
    // a property of today's callers, not of this function. It takes a bare
    // string and joins it into a path; leaving the check to a convention is
    // how the next caller writes the traversal.
    for (const hostile of ['../../etc/passwd', 'a/b', 'Blueberry', 'con']) {
      const resolved = resolveAvatarById(workspace(), hostile)
      expect(resolved.source, hostile).toBeNull()
      expect(resolved.problems.length, hostile).toBeGreaterThan(0)
    }
  })

  it('gives the built-in back when nothing is named', async () => {
    const { resolveAvatarById } = await import('./avatars')
    const resolved = resolveAvatarById(workspace(), null)
    expect(resolved.source).toBeNull()
    expect(resolved.problems).toEqual([])
  })
})

describe('creating a persona never overwrites what is already in the folder', () => {
  it('refuses when a file of that name exists but is not in the catalog', () => {
    const dir = workspace()
    // Malformed, so it is absent from the catalog -- and still somebody's only
    // copy of a character. Catalog uniqueness is not evidence the FOLDER is
    // free.
    mkdirSync(join(personasRoot(dir), 'ada'), { recursive: true })
    writeFileSync(join(personasRoot(dir), 'ada', MANIFEST), '{ half a file')

    expect(() => copyPersonaTo(dir, loadPersonas(dir, {}), DEFAULT_PERSONA, 'Ada')).toThrow(
      /refusing to overwrite/,
    )
    expect(readFileSync(join(personasRoot(dir), 'ada', MANIFEST), 'utf8')).toBe('{ half a file')
  })

  it('folds case, because macOS gives one file two spellings', () => {
    const dir = workspace()
    mkdirSync(join(personasRoot(dir), 'ADA'), { recursive: true })
    writeFileSync(join(personasRoot(dir), 'ADA', MANIFEST), 'sentinel')

    expect(() => copyPersonaTo(dir, loadPersonas(dir, {}), DEFAULT_PERSONA, 'Ada')).toThrow(
      /refusing to overwrite/,
    )
    expect(readFileSync(join(personasRoot(dir), 'ADA', MANIFEST), 'utf8')).toBe('sentinel')
  })

  it('writes normally when the name really is free', () => {
    const dir = workspace()
    const written = copyPersonaTo(dir, loadPersonas(dir, {}), DEFAULT_PERSONA, 'Ada')
    expect(written).toEqual({ id: 'ada', source: 'ada' })
  })
})

describe('a hand-renamed file', () => {
  it('keeps the persona and her id when renamed between launches', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    // Renamed while the app was not running, then reloaded: the id lives in
    // the file, so only the source path changed.
    renameSync(join(personasRoot(dir), 'ada'), join(personasRoot(dir), 'my-tutor'))

    const catalog = loadPersonas(dir, {})
    expect(catalog.personas.get('ada')?.name).toBe('Ada')
    expect(catalog.sources.get('ada')).toBe('my-tutor')

    savePersonaTo(dir, catalog, { ...tutor, id: 'ada', name: 'Ada Lovelace' })
    // Written back to the file it came from -- not to a recreated `ada.json`.
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(false)
    expect(loadPersonas(dir, {}).personas.get('ada')?.name).toBe('Ada Lovelace')
  })

  it('refuses to save when the file moved AFTER loading, rather than recreating it', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    const catalog = loadPersonas(dir, {})
    // Renamed underneath a running app. The map is now stale by design.
    renameSync(join(personasRoot(dir), 'ada'), join(personasRoot(dir), 'moved'))

    // The message names the IDENTITY rather than the path, because the check
    // is now the stronger one: the folder must still be there AND still be
    // hers. Checking only the name left the case that matters -- a folder
    // renamed and a different package moved into its place, at which point the
    // save overwrites the replacement's manifest.
    expect(() => savePersonaTo(dir, catalog, { ...tutor, id: 'ada', name: 'Ada L' })).toThrow(
      /is no longer ada/,
    )
    // Recreating `ada.json` would leave two files claiming one id, which the
    // next launch refuses as a duplicate -- so neither would load.
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(false)
    expect(loadPersonas(dir, {}).personas.get('ada')?.name).toBe('Ada')
  })
})

describe('deleting a persona takes her notes with her', () => {
  it('removes the file and the memory filed under the id', async () => {
    const { recall, remember } = await import('./memory')
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    remember(dir, 'ada', 'They are learning Rust.')
    expect(recall(dir, 'ada')).toContain('Rust')

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(false)
    // The notes go too. Ids are DERIVED from names, so `ada` is handed out
    // again the moment nothing holds it -- and a new persona inheriting a
    // stranger's notes is the privacy failure the per-id filing exists to
    // prevent. Leaving them would make that inevitable, not unlikely.
    expect(recall(dir, 'ada')).toBe('')
  })

  it('succeeds for a persona who was never spoken to', async () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    // No memory file exists. Absent is success -- treating it as a failure
    // would make deleting a quiet character report an error.
    expect(() => deletePersona(dir, loadPersonas(dir, {}), 'ada', history)).not.toThrow()
    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(false)
  })

  it('keeps her id reserved when clearing what is filed under it fails', async () => {
    // The package folder is what holds the id. Removing it first meant a
    // failure anywhere below released `ada` with a stranger's conversations
    // still filed under that name -- and ids are DERIVED from names, so the
    // next Ada would have inherited them.
    //
    // What changed with the deletion mark: she is no longer LISTED while the
    // deletion is unfinished. She used to be, with her memory already deleted,
    // which is the half-deleted state this now makes unreachable -- the user
    // asked for her to go, and the parts of her that are gone do not come back.
    // Her id stays taken until every store agrees she is gone.
    const { recall, remember } = await import('./memory')
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    remember(dir, 'ada', 'They are learning Rust.')
    const refuses = {
      forget: () => {
        throw new Error('SQLITE_BUSY')
      },
    }

    expect(() => deletePersona(dir, loadPersonas(dir, {}), 'ada', refuses)).toThrow(/BUSY/)

    const after = loadPersonas(dir, {})
    expect(after.personas.has('ada'), 'she came back half-deleted').toBe(false)
    expect(after.reserved.has('ada'), 'her id was released with her data still here').toBe(true)
    expect(recall(dir, 'ada')).toBe('')
    // Her package is still on disk, so nothing else can take the name.
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(true)

    // And the sweep finishes it, on this launch or the next one.
    sweepDeletions(dir, history)
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(false)
    expect(loadPersonas(dir, {}).reserved.has('ada')).toBe(false)
  })

  it('puts her retention back when the package cannot be removed', () => {
    // Deleting the policy before the package protects the NEXT persona of that
    // name; deleting it after protects THIS one. Neither is safe alone: a
    // failed package removal leaves her present, and an absent policy means
    // keep -- so she would carry on recording without the opt-out she chose.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    writePolicy(dir, 'ada', { keeps: false })
    const catalog = loadPersonas(dir, {})
    // A personas folder that cannot be written to, so the removal fails.
    chmodSync(personasRoot(dir), 0o500)

    expect(() => deletePersona(dir, catalog, 'ada', history)).toThrow(/EACCES/)

    chmodSync(personasRoot(dir), 0o700)
    // Her setting is back. That is what this guarantees and all it guarantees:
    // `rmSync` recursive is not atomic, so the failure above can leave the
    // package half-removed -- worth knowing, and a separate problem from this
    // one. What must not happen is her surviving in ANY form with the opt-out
    // silently replaced by the keep-everything default.
    expect(policyState(dir, 'ada').policy).toEqual({ keeps: false })
  })

  it('refuses when her folder has moved since the catalog was read', async () => {
    const { recall, remember } = await import('./memory')
    // `sources` is a snapshot. A folder renamed by hand makes it stale, and
    // this used to erase her notes, conversations, progress and retention and
    // then force-remove a path that no longer exists -- reporting success
    // while deleting the state of a persona whose package is still on disk.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    remember(dir, 'ada', 'They are learning Rust.')
    const catalog = loadPersonas(dir, {})
    renameSync(join(personasRoot(dir), 'ada'), join(personasRoot(dir), 'ada-renamed'))

    expect(() => deletePersona(dir, catalog, 'ada', history)).toThrow(/no longer ada/)

    // Nothing was destroyed on the way to finding out.
    expect(recall(dir, 'ada')).toContain('Rust')
  })

  it('refuses when a DIFFERENT persona now occupies her folder', async () => {
    // The case checking the name alone misses, and the expensive one: this
    // would erase Ada's notes and conversations and then remove the package
    // that is now Coach's.
    const { recall, remember } = await import('./memory')
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    remember(dir, 'ada', 'They are learning Rust.')
    const catalog = loadPersonas(dir, {})
    // Somebody swaps the contents of that folder for another character.
    write(dir, 'ada', { ...tutor, id: 'coach', name: 'Coach' })

    expect(() => deletePersona(dir, catalog, 'ada', history)).toThrow(/no longer ada/)

    expect(recall(dir, 'ada')).toContain('Rust')
    expect(loadPersonas(dir, {}).personas.has('coach')).toBe(true)
  })

  it('refuses the built-in, which has no file', () => {
    const dir = workspace()
    expect(() => deletePersona(dir, loadPersonas(dir, {}), BUILT_IN_ID, history)).toThrow(/no file/)
  })

  it('leaves everybody else alone', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    write(dir, 'coach', { ...tutor, id: 'coach', name: 'Coach' })

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    const after = loadPersonas(dir, {})
    expect(after.personas.get('coach')?.name).toBe('Coach')
    expect(after.problems).toEqual([])
  })
})

describe('a package is a folder, so she can carry her own face', () => {
  it('wears the face in her package', async () => {
    const { resolveFaceFor } = await import('./avatars')
    const { MOCHI } = await import('@shared/avatar-spec')
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada' })
    writeFileSync(
      join(personasRoot(dir), 'ada', 'face.json'),
      JSON.stringify({ ...MOCHI, colBody: '#8aa8e8' }),
    )

    // A theme is passed and DOES NOT WIN. `parseFaceSpec` requires all five
    // colour fields, so a face on disk states its colours deliberately;
    // retinting it would make those fields unreachable.
    const resolved = resolveFaceFor(dir, join(personasRoot(dir), 'ada'), null, 'sky')
    expect(resolved.source).toBe('face.json')
    expect(resolved.face.colBody).toBe('#8aa8e8')
  })

  it('falls back to the shared avatars folder when she carries none', async () => {
    const { resolveFaceFor } = await import('./avatars')
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada' })
    // No face.json in the package, and no avatarId either.
    const resolved = resolveFaceFor(dir, join(personasRoot(dir), 'ada'), null, 'moss')
    expect(resolved.source).toBeNull()
    expect(resolved.problems).toEqual([])
  })

  it('paints the built-in in her theme, which nothing used to read', async () => {
    const { resolveFaceFor } = await import('./avatars')
    const { paletteFor } = await import('@shared/theme')
    const { MOCHI } = await import('@shared/avatar-spec')
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada' })

    /*
      `Persona.theme` was validated, migrated, tested — and read by nothing.
      `applyTheme` had no caller anywhere in the tree, so eight themes were
      storable and one green mochi was drawn. This is the assertion that says
      the field reaches the paint.
    */
    const resolved = resolveFaceFor(dir, join(personasRoot(dir), 'ada'), null, 'sky')
    expect(resolved.source).toBeNull()
    expect(resolved.face.colBody).toBe(paletteFor('sky').colBody)
    expect(resolved.face.colBody).not.toBe(MOCHI.colBody)
    // Colour only. Her geometry is what a tuner decides and a theme may not
    // touch it — see `applyTheme`.
    expect(resolved.face.bodyH).toBe(MOCHI.bodyH)
  })

  it('refuses a package that both carries a face and names one', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', avatarId: 'blueberry' })
    writeFileSync(join(personasRoot(dir), 'ada', 'face.json'), '{}')

    // Alternatives, never a precedence chain. A precedence rule is one
    // somebody has to remember and this format would have to defend forever.
    const catalog = loadPersonas(dir, {})
    expect(catalog.problems).toContainEqual({ kind: 'two-faces', source: 'ada' })
    expect(catalog.personas.has('ada')).toBe(false)
  })

  it('deletes the whole package, not just the manifest', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada' })
    writeFileSync(join(personasRoot(dir), 'ada', 'face.json'), '{}')

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    // An orphaned folder reads as a persona that failed to load rather than
    // one that was deleted.
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(false)
  })
})

describe('the retention setting is hers, not her package’s', () => {
  it('does not travel into a copy', () => {
    // A new identity starts with no setting of its own. Copying one
    // used to carry `keeps`/`keepDays` along with the prose, because they were
    // manifest fields -- so duplicating a persona who kept nothing produced a
    // second persona who kept nothing without anybody choosing that, and the
    // reverse just as easily.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    writePolicy(dir, 'ada', { keeps: false })

    const made = copyPersonaTo(
      dir,
      loadPersonas(dir, {}),
      loadPersonas(dir, {}).personas.get('ada')!,
      'Ada 2',
    )

    expect(policyState(dir, made.id).exists).toBe(false)
    expect(policyState(dir, made.id).policy).toEqual(DEFAULT_POLICY)
    // Hers is untouched.
    expect(policyState(dir, 'ada').policy).toEqual({ keeps: false })
  })

  it('survives putting the built-in back to how she ships', () => {
    // Restoring deletes her whole overlay. With retention inside it, "put the
    // wording back" also turned transcript storage back on -- an undo of the
    // prose is not a request to start recording.
    const dir = workspace()
    writePolicy(dir, BUILT_IN_ID, { keeps: false })

    restoreBuiltIn(dir)

    expect(policyState(dir, BUILT_IN_ID).policy).toEqual({ keeps: false })
  })

  it('goes when she does, so the next persona of that name does not inherit it', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    writePolicy(dir, 'ada', { keeps: false })

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    expect(policyState(dir, 'ada').exists).toBe(false)
    expect(policyState(dir, 'ada').policy).toEqual(DEFAULT_POLICY)
  })
})

describe('a package carries a face or names one, never both', () => {
  it('counts a face.json it cannot read as present', () => {
    // The same mistake `hasPolicy` had, and the second one makes it a class:
    // when the question is "is there a file", absent is the only answer that
    // means no. Reading unreadable as absent let the two-face rule be decided
    // by whether this process happened to be able to open it.
    const dir = workspace()
    const folder = join(personasRoot(dir), 'ada')
    mkdirSync(folder, { recursive: true })
    expect(hasOwnFace(folder)).toBe(false)
    symlinkSync('/etc/hosts', join(folder, PACKAGE_FACE))
    expect(hasOwnFace(folder)).toBe(true)
  })

  it('refuses a save that would name one on a package that carries one', () => {
    // Only this function sees both halves, so without the check a save wrote a
    // manifest the next launch refuses: the persona vanishes from the shelf,
    // and the action that did it looked like it worked.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    writeFileSync(join(personasRoot(dir), 'ada', PACKAGE_FACE), '{}')
    const catalog = loadPersonas(dir, {})
    const hers = catalog.personas.get('ada')
    expect(hers).toBeDefined()

    expect(() => savePersonaTo(dir, catalog, { ...hers!, avatarId: 'somebody' })).toThrow(
      /already carries its own face/,
    )

    // And a save that does NOT name a face still works.
    expect(() => savePersonaTo(dir, catalog, { ...hers!, name: 'Ada 2' })).not.toThrow()
  })
})

describe('rolling back a fork whose follow-up failed', () => {
  it('removes the package, which is a folder', () => {
    // `discardWrite` used `unlinkSync`, which is from before a package was a
    // folder -- so every call threw `EPERM`, was caught by its own handler and
    // logged. The rollback never happened: the save reported failure and the
    // extra persona was in the list anyway.
    const dir = workspace()
    write(dir, 'ada-2', { ...tutor, id: 'ada-2', name: 'Ada 2' })
    expect(loadPersonas(dir, {}).personas.has('ada-2')).toBe(true)

    discardWrite(dir, 'ada-2')

    expect(existsSync(join(personasRoot(dir), 'ada-2'))).toBe(false)
    expect(loadPersonas(dir, {}).personas.has('ada-2')).toBe(false)
  })
})

describe('deleting her takes the conversations too', () => {
  it('leaves no transcript a recycled id could inherit', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    const session = history.begin('ada', 1000)
    if (session === null) throw new Error('that instant was already taken')
    history.say(session, 'you', 'something private', 1010)
    history.end(session, 1020)
    expect(history.search('ada', 'private')).toHaveLength(1)

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    // The defect this is here for: memory was forgotten and transcripts were
    // not. Ids are DERIVED from names, so `ada` is handed out again the moment
    // nothing holds it -- and the next Ada would have inherited these.
    expect(history.sessions('ada')).toEqual([])
    expect(history.search('ada', 'private')).toEqual([])
  })

  it('leaves everybody else’s conversations alone', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    write(dir, 'coach', { ...tutor, id: 'coach', name: 'Coach' })
    const kept = history.begin('coach', 1000)
    if (kept === null) throw new Error('that instant was already taken')
    history.say(kept, 'her', 'still here', 1010)

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    expect(history.search('coach', 'still')).toHaveLength(1)
  })
})

/**
 * The one-time retention gate closes on a pass that could SEE everything.
 *
 * It used to close whatever happened. A personas folder that could not be
 * listed, or a manifest that could not be opened, still marked the migration
 * done — so a transient permissions problem on one launch cost a user their
 * stored `keeps: false` for good, and the fallback for a missing policy is to
 * KEEP: they would start recording without being told.
 */
describe('a folder replaced underneath a running app', () => {
  const swap = (dir: string): void => {
    // `ada`'s folder renamed away and a DIFFERENT package moved into the name.
    renameSync(join(personasRoot(dir), 'ada'), join(personasRoot(dir), 'elsewhere'))
    write(dir, 'ada', { ...tutor, id: 'coach', name: 'Coach' })
  }

  it('is not written over by a save', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    const catalog = loadPersonas(dir, {})
    swap(dir)

    expect(() => savePersonaTo(dir, catalog, { ...tutor, id: 'ada', name: 'Ada L' })).toThrow(
      /is no longer ada/,
    )
    // Checking only that the NAME still exists let this through, and the
    // replacement's manifest was overwritten with somebody else's persona.
    const standing = JSON.parse(
      readFileSync(join(personasRoot(dir), 'ada', MANIFEST), 'utf8'),
    ) as Persona
    expect(standing.id).toBe('coach')
  })

  it('is not copied from', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    writeFileSync(join(personasRoot(dir), 'ada', 'extra.txt'), 'ada’s own file')
    const catalog = loadPersonas(dir, {})
    swap(dir)
    writeFileSync(join(personasRoot(dir), 'ada', 'extra.txt'), 'coach’s file')

    // Copying trusted the cached source alone, which produced a hybrid: another
    // persona's files under this persona's manifest.
    expect(() => copyPersonaTo(dir, catalog, catalog.personas.get('ada')!, 'Ada Two')).toThrow(
      /is no longer ada/,
    )
  })
})

describe('saving a persona the catalog does not hold', () => {
  it('is refused rather than quietly creating one', () => {
    // The branch that used to be here contradicted the function's own first
    // line and was unreachable through the settings window. Creation belongs to
    // `copyPersonaTo`, behind the button that says so.
    const dir = workspace()
    const catalog = loadPersonas(dir, {})
    expect(() => savePersonaTo(dir, catalog, { ...tutor, id: 'nobody' })).toThrow(
      /use copyPersonaTo/,
    )
    expect(existsSync(join(personasRoot(dir), 'nobody'))).toBe(false)
  })
})

describe('a v1 retention choice this build cannot carry refuses the package', () => {
  /*
    The privacy regression this closes, and how it arrived.

    v1 wrote `keeps` into the manifest; the loader moved it into the policy
    store on first read. That migration was deleted with the rest of the v1
    layer on the argument that there are no v1 installs to migrate — but
    `parsePersona` still hands the fields back, so for a moment a manifest
    saying `keeps: false` was parsed, its opt-out read, and dropped. She loaded,
    and recorded, having asked not to be.

    The fallback for a missing policy is to KEEP, which is the one direction a
    dropped privacy choice must never fail in.
  */
  it('does not admit a persona whose stored opt-out would be discarded', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada', version: 1, keeps: false })

    const catalog = loadPersonas(dir, {})
    expect(catalog.personas.has('ada'), 'she loaded and would record').toBe(false)
  })

  it('says which package it was, so it is not a character that simply vanished', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada', version: 1, keeps: false })

    expect(loadPersonas(dir, {}).problems).toContainEqual({
      kind: 'retention-unsupported',
      id: 'ada',
      source: 'ada',
    })
  })

  it('refuses a finite retention request, which used to read as the default', () => {
    /*
      `keepDays` has no representation in the current `Policy`, so
      `parsePersona` normalised `{keepDays: 7}` to `{keeps: true}` — and a
      guard comparing the PARSED value against the default read a seven-day
      request as "asks for nothing" and kept for ever.
    */
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada', version: 1, keepDays: 7 })

    const catalog = loadPersonas(dir, {})
    expect(catalog.personas.has('ada'), 'a seven-day request loaded as indefinite').toBe(false)
    expect(catalog.problems).toContainEqual({
      kind: 'retention-unsupported',
      id: 'ada',
      source: 'ada',
    })
  })

  it('refuses a retention field it cannot even read', () => {
    // `parsePolicy` answers null for a malformed `keeps`, and a null parsed
    // value read as "declared nothing at all" — so the guard was bypassed
    // entirely by the one shape nobody can interpret.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada', version: 1, keeps: 'no' })

    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(false)
  })

  it('admits one whose declaration asks for the default, because it asks for nothing', () => {
    // `keeps: true` is what an installation with no policy file already does.
    // Refusing a character over a field that changes nothing would be a cost
    // with no privacy behind it.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada', version: 1, keeps: true })

    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(true)
  })

  it('admits an ordinary v2 package, which declares no retention at all', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })

    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(true)
  })
})

/**
 * Every recursive removal under the personas root goes through the allowlist.
 *
 * `deleting.ts` carries the argument: `'.'` passed the old blocklist and
 * `join(personasRoot, '.')` IS the root, so one bad value took every persona.
 * That guard was added where MARKS are read. These two removals are the other
 * doors to the same `rmSync`, and a rule applied at one door is not a rule.
 *
 * Exercised against real folders — created, then deleted — rather than a stub,
 * because what is being asserted is which directory `rmSync` is pointed at.
 */
describe('what may be removed under the personas root', () => {
  it('deletes a real persona it created, and leaves her neighbours', () => {
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    write(dir, 'bo', { ...tutor, id: 'bo', name: 'Bo' })
    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(true)

    deletePersona(dir, loadPersonas(dir, {}), 'ada', history)

    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(false)
    // The one that matters: the sibling package is untouched and still loads.
    expect(existsSync(join(personasRoot(dir), 'bo'))).toBe(true)
    expect(loadPersonas(dir, {}).personas.has('bo')).toBe(true)
  })

  it('refuses to discard a folder name that names the root itself', () => {
    /*
      `discardWrite` force-removes recursively and validated nothing. `'.'`
      resolves to `personasRoot`, so a rollback with a bad source would have
      taken every persona on the machine — while rolling back a FAILED SAVE,
      which is the moment somebody least expects to lose anything.
    */
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    for (const bad of ['.', '..', '', 'a/b']) {
      discardWrite(dir, bad)
    }
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(true)
    expect(loadPersonas(dir, {}).personas.has('ada')).toBe(true)
  })

  it('still discards the fork it was meant to discard', () => {
    // The guard has to refuse the dangerous values without refusing the job.
    const dir = workspace()
    write(dir, 'ada', { ...tutor, id: 'ada', name: 'Ada' })
    write(dir, 'fork', { ...tutor, id: 'fork', name: 'Fork' })
    discardWrite(dir, 'fork')
    expect(existsSync(join(personasRoot(dir), 'fork'))).toBe(false)
    expect(existsSync(join(personasRoot(dir), 'ada'))).toBe(true)
  })
})
