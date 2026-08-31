#!/usr/bin/env node
/**
 * Move the version, prove the tree deserves it, tag it. Refuses, never warns.
 *
 *     node scripts/bump.mjs patch
 *     node scripts/bump.mjs minor --notes /tmp/notes.md
 *     node scripts/bump.mjs 0.2.0 --push
 *     node scripts/bump.mjs patch --dry-run
 *
 * ## Why this is a script and not a procedure somebody follows
 *
 * It was a procedure somebody followed — a page of prose describing seven
 * steps, and every one of them held only as long as whoever ran it read to the
 * end. Nothing mechanically stopped a bump over a red suite, and nothing
 * noticed if the version edit came out as a reformatted `package.json`.
 *
 * The prose also lived in `.claude/`, which this repository does not track. It
 * existed on one machine. A release procedure that a fresh clone does not have
 * is not a procedure, it is a habit.
 *
 * ## What it will not do
 *
 * - run on a dirty tree — a version describes committed work
 * - reuse a tag that already exists here or on the remote
 * - continue over a red `pnpm verify` or a failed `pnpm build`, and it puts the
 *   version back when it stops, so a red gate leaves nothing behind
 * - commit anything but the one line — the diff is checked, not assumed
 * - write a lightweight tag
 * - push, unless asked
 *
 * ## The one thing it does NOT enforce
 *
 * Which bump. `patch`, `minor` and `major` are named on the command line and
 * never inferred from commit subjects: while the major is 0 a breaking change
 * belongs in the minor, and going to 1.0.0 is a claim about stability that no
 * commit prefix can make on somebody's behalf.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = join(ROOT, 'package.json')

const bold = (s) => `[1m${s}[0m`
const note = (s) => console.log(`\n${bold(s)}`)
const good = (s) => console.log(`  [32mok[0m    ${s}`)
function stop(why) {
  console.error(`  [31mFAIL[0m  ${why}`)
  process.exit(1)
}

/** Every git call goes through here: an args array, so no shell parses input. */
function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' })
}

// ---- what was asked for -----------------------------------------------------

const argv = process.argv.slice(2)
const asked = argv.find((one) => !one.startsWith('--'))
const PUSH = argv.includes('--push')
const DRY = argv.includes('--dry-run')
const notesAt = argv.indexOf('--notes')
const NOTES = notesAt === -1 ? null : argv[notesAt + 1]

if (asked === undefined) {
  stop('name the bump: patch, minor, major, or an exact version like 0.2.0')
}

const manifest = readFileSync(MANIFEST, 'utf8')
const current = JSON.parse(manifest).version
const parts = current.split('.').map(Number)
if (parts.length !== 3 || parts.some((one) => !Number.isInteger(one))) {
  stop(`package.json holds "${current}", which is not a three-part version`)
}
const [major, minor, patch] = parts

const next =
  asked === 'patch'
    ? `${String(major)}.${String(minor)}.${String(patch + 1)}`
    : asked === 'minor'
      ? `${String(major)}.${String(minor + 1)}.0`
      : asked === 'major'
        ? `${String(major + 1)}.0.0`
        : asked
if (!/^\d+\.\d+\.\d+$/.test(next)) stop(`"${asked}" is neither a bump nor a version`)
const TAG = `v${next}`

// ---- refusals, before anything is touched -----------------------------------

note(`${current} → ${next}`)

const dirty = git('status', '--porcelain')
if (dirty !== '') {
  console.error(`  [31mFAIL[0m  the tree is dirty; a version describes committed work`)
  for (const line of dirty.split('\n')) console.error(`          ${line}`)
  process.exit(1)
}
good('the tree is clean')

const here = git('tag', '--list', TAG)
if (here !== '') stop(`${TAG} already exists here`)
const there = git('ls-remote', '--tags', 'origin', TAG)
if (there !== '') stop(`${TAG} already exists on the remote — pick another version`)
good(`${TAG} is free, here and on the remote`)

/*
  The range, and the no-tag case is not an error.

  `git describe` FAILS rather than returning empty when there are no tags, and
  in CI it fails on a repository full of them because `actions/checkout` does
  not fetch tags at its default depth. Both mean "no previous tag I can see",
  and the honest fallback is the whole history.
*/
let previous = null
try {
  previous = git('describe', '--tags', '--abbrev=0')
} catch {
  previous = null
}
const range = previous === null ? [] : [`${previous}..HEAD`]
const subjects = git('log', ...range, '--format=%s')
  .split('\n')
  .filter(Boolean)
good(`${String(subjects.length)} commits since ${previous ?? 'the beginning'}`)

// ---- the edit ---------------------------------------------------------------

/*
  A targeted replacement, never `JSON.stringify`.

  Serialising the manifest reorders nothing today and reformats everything the
  day someone's editor writes it differently — and the diff this script checks
  below would then be a hundred lines with the version buried in them. One line
  in, one line out.
*/
const line = `"version": "${current}"`
if (manifest.split(line).length !== 2) {
  stop(`expected exactly one \`${line}\` in package.json`)
}
if (DRY) {
  note('--dry-run: stopping before anything is written')
  console.log(`  would set version to ${next}`)
  console.log(`  would run pnpm verify and pnpm build`)
  console.log(`  would commit, tag ${TAG}${PUSH ? ', and push' : ' (no push)'}`)
  process.exit(0)
}
writeFileSync(MANIFEST, manifest.replace(line, `"version": "${next}"`))

/** Put it back. Called whenever this stops after the edit. */
function undo() {
  git('checkout', '--', 'package.json')
}

// ---- the gate ---------------------------------------------------------------

note('the gate')
try {
  run('pnpm', ['verify'])
  run('pnpm', ['build'])
} catch {
  undo()
  stop('the gate is red — the version has been put back, nothing was committed')
}
good('verify and build are green')

// ---- exactly one line -------------------------------------------------------

const changed = git('diff', '--numstat')
if (changed !== `1\t1\tpackage.json`) {
  undo()
  stop(`expected one changed line in package.json, got:\n          ${changed || '(nothing)'}`)
}
good('the diff is one line of package.json')

// ---- the message ------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'mochi-bump-'))
const messageAt = join(scratch, 'message.txt')
const body =
  NOTES === null
    ? `chore(release): ${TAG}\n\n${subjects.map((one) => `- ${one}`).join('\n')}\n`
    : readFileSync(NOTES, 'utf8')
writeFileSync(messageAt, body)
if (NOTES === null) {
  console.log(
    `  note  no --notes given; the body is the ${String(subjects.length)} commit subjects`,
  )
}

// ---- commit and tag ---------------------------------------------------------

try {
  git('add', 'package.json')
  git('commit', '-F', messageAt)
  // ANNOTATED. A lightweight tag carries no date, no author and no message, and
  // `release.yml` reads the annotation for the release notes.
  git('tag', '-a', TAG, '-F', messageAt)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
good(`committed and tagged ${TAG}`)

// ---- push, only if asked ----------------------------------------------------

if (PUSH) {
  note('pushing')
  git('push', 'origin', 'main')
  git('push', 'origin', TAG)
  good(`${TAG} is on the remote — the release workflow is running`)
} else {
  note('not pushed. When you are ready:')
  console.log(`\n    git push origin main\n    git push origin ${TAG}\n`)
}
