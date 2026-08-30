#!/usr/bin/env node
/**
 * The rendered gate: what the window actually DRAWS, checked against a
 * populated profile.
 *
 * ## Why this exists separately from `pnpm test`
 *
 * Everything in `src/renderer/rules` is a decision with no view, and vitest
 * holds all of it. What vitest cannot see is the half that only exists once a
 * browser has laid the window out: whether a day with nothing on it is a
 * button, whether the destructive control is last in the dialog, whether a
 * character with no face file is SAID to have none or silently drawn with
 * somebody else's. Those are the rules that got lost every time the view was
 * rewritten, because nothing failed when they went.
 *
 * ## The profile is seeded, and that is the whole point
 *
 * The previous pass of this work verified against a fresh profile -- one
 * character, zero conversations -- and passed twenty-two checks while six real
 * regressions sat on screen, invisible because the states that show them had no
 * data to render. So this launches twice: once to let the app create its own
 * store and to duplicate a character through the app's own UI, then again over
 * a store with conversations across several days, an interrupted turn,
 * searchable text, and a character whose face file has been taken away.
 *
 * ## No backticks below this line
 *
 * Every page expression is a template literal, so a backtick inside one -- a
 * markdown code span in a comment is enough -- ends the string early and breaks
 * this file's syntax. It has happened four times. `node --check` catches it and
 * is worth running after any edit here.
 *
 * ## Seeding
 *
 * Seeding through the UI rather than by writing persona JSON is deliberate:
 * the manifest format has a version and required fields, and a gate carrying
 * its own copy of that shape would start lying the first time the format moved.
 */
import { spawn, execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { setTimeout as wait } from 'node:timers/promises'

// A port of its own per run, so two gates -- or a stray from a killed run --
// cannot answer for each other. A fixed port is how a run silently attaches to
// somebody else's window and reports on a profile it never seeded.
const PORT = 9300 + (process.pid % 600)
const ROOT = process.cwd()

/* ---- talking to the window ---------------------------------------------- */

async function listTargets() {
  const answer = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return answer.json()
}

async function waitForTarget(match, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    await wait(500)
    let list
    try {
      list = await listTargets()
    } catch {
      continue
    }
    const found = list.find((t) => t.url.includes(match))
    if (found) return found
  }
  return null
}

async function attach(target) {
  const { default: WS } = await import('ws')
  const ws = new WS(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      id += 1
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Runtime.enable')
  return {
    send,
    close: () => ws.close(),
    async run(expression) {
      const reply = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      const failed = reply.result?.exceptionDetails
      if (failed) throw new Error(failed.exception?.description ?? JSON.stringify(failed))
      return reply.result?.result?.value
    },
  }
}

/* ---- the app ------------------------------------------------------------ */

function launch(userData) {
  // The binary directly, and in its own process group. Going through `npx`
  // means the signal reaches a wrapper while Electron carries on holding the
  // debugging port -- which the next run then attaches to, and reports on.
  const app = spawn(
    electronBinary(),
    ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`],
    {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  )
  let log = ''
  app.stdout.on('data', (d) => (log += d))
  app.stderr.on('data', (d) => (log += d))
  return { app, said: () => log }
}

function electronBinary() {
  // The package's own export, which is the binary path for whatever platform
  // installed it. Hardcoding the macOS bundle path would make this file quietly
  // wrong everywhere else rather than loudly wrong.
  const path = createRequire(import.meta.url)('electron')
  if (typeof path !== 'string' || !existsSync(path)) {
    throw new Error('no Electron binary — run pnpm install')
  }
  return path
}

/** The whole group, so nothing outlives the run holding the debugging port. */
function endGroup(app) {
  try {
    process.kill(-app.pid, 'SIGTERM')
  } catch {
    app.kill('SIGTERM')
  }
}

async function stop(running) {
  endGroup(running.app)
  for (let i = 0; i < 20; i += 1) {
    await wait(250)
    if (running.app.exitCode !== null || running.app.signalCode !== null) break
  }
  if (running.app.exitCode === null && running.app.signalCode === null) {
    try {
      process.kill(-running.app.pid, 'SIGKILL')
    } catch {
      running.app.kill('SIGKILL')
    }
  }
  // Wait for the debugging port to go with it. Relaunching while the dying
  // instance still holds it means the next attach lists the OLD window, which
  // fails in a way that reads as a slow launch rather than as a stale port.
  for (let i = 0; i < 40; i += 1) {
    await wait(250)
    try {
      await listTargets()
    } catch {
      return
    }
  }
}

/** The shell is opened on demand, never at launch. Ask the companion for it. */
async function openShell() {
  const companion = await waitForTarget('companion')
  if (!companion) throw new Error('the companion window never appeared')
  const bridge = await attach(companion)
  await bridge.run('window.mochi.history()')
  bridge.close()
  const shell = await waitForTarget('history', 40)
  if (!shell) throw new Error('the shell never appeared after asking for it')
  const page = await attach(shell)
  // The shell reads characters, then conversations, then draws. Waiting on a
  // drawn tablist rather than on a duration, so a slow machine does not turn
  // this into a flake generator.
  for (let i = 0; i < 40; i += 1) {
    // Her three numbered views. They are built once, on the first render, so
    // their presence is the signal that the window has drawn rather than that
    // it has loaded.
    const ready = await page.run(`document.querySelectorAll('.view[role=tab]').length >= 3`)
    if (ready) break
    await wait(250)
  }
  return page
}

/* ---- seeding ------------------------------------------------------------ */

const DAY = 86_400_000
/** Fixed, so a check that depends on which month is shown does not drift. */
const NOON = new Date(2026, 4, 14, 12, 0, 0).getTime()
/** The built-in, and the one this gate makes. */
const PEOPLE = ['mochi', 'wisp']
/** What A6 copies. Every character in it is load-bearing. */
const AWKWARD = '  Two lines about the harbour,\nand a trailing space  '

/**
 * Conversations, written straight into the store the app just created.
 *
 * The DDL is not repeated here -- the app made the tables on its first launch
 * and this only inserts rows. A gate carrying its own schema is a gate that
 * passes against a shape the app no longer uses.
 */
function seedConversations(userData) {
  const db = new DatabaseSync(join(userData, 'transcripts.db'))
  const session = db.prepare(
    'INSERT INTO session (persona_id, started_at, ended_at) VALUES (?, ?, ?)',
  )
  const turn = db.prepare(
    'INSERT INTO turn (session_id, at, who, text, cut) VALUES (?, ?, ?, ?, ?)',
  )
  const fts = db.prepare('INSERT INTO turn_fts (body, turn_id, persona_id) VALUES (?, ?, ?)')
  const talks = [
    {
      day: 0,
      turns: [
        ['you', 'tell me about the harbour', 0],
        ['her', 'The harbour is quiet this morning.', 0],
      ],
    },
    {
      day: 0,
      turns: [
        ['you', 'and the lighthouse', 0],
        ['her', 'It still turns.', 0],
      ],
    },
    {
      day: 2,
      turns: [
        ['you', 'what about the harbour again', 0],
        ['her', '', 1],
      ],
    },
    // Her line here is deliberately awkward: two lines, a leading indent and a
    // trailing space. Reading the bubble back out of the DOM collapses all
    // three, so an exact match is what tells a raw copy from a rendered one.
    {
      day: 5,
      turns: [
        ['you', 'read me something', 0],
        ['her', AWKWARD, 0],
      ],
    },
  ]
  // Each conversation gets its own instant: the store holds one session per
  // persona per instant, which is what makes importing the same archive twice a
  // no-op. Two on one day therefore have to differ by more than the date.
  // Both characters, because creating the second one wears it and which one is
  // worn is not this gate's business -- an archive that is empty because the
  // seed went to the other character would fail every check below for a reason
  // that has nothing to do with the window.
  for (const who of PEOPLE)
    talks.forEach((talk, index) => {
      const began = NOON - talk.day * DAY + index * 3_600_000
      const made = session.run(who, began, began + 60_000)
      const sessionId = Number(made.lastInsertRowid)
      let at = began
      for (const [who, text, cut] of talk.turns) {
        at += 5_000
        const row = turn.run(sessionId, at, who, text, cut)
        if (text !== '') fts.run(text, Number(row.lastInsertRowid), who)
      }
    })
  db.close()
}

/**
 * A second character, made the way a person makes one, and then robbed of its
 * face file.
 *
 * A character whose face file is MISSING is the case C4 exists for, and it
 * cannot be reached from a fresh profile -- the built-in has no file to lose.
 * Renaming rather than deleting, so the failure is a broken reference and not
 * an empty folder, which are different states and the app distinguishes them.
 */
function breakAFace(userData) {
  const root = join(userData, 'personas')
  if (!existsSync(root)) return { broke: null, why: 'no personas folder was written' }
  const folders = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
  if (folders.length === 0) return { broke: null, why: 'the duplicate wrote no folder' }
  const manifest = join(root, folders[0].name, 'persona.json')
  if (!existsSync(manifest)) return { broke: null, why: 'the duplicate wrote no manifest' }
  // One field, read and written back. Authoring a whole manifest here would
  // mean this gate carrying a copy of a versioned format, and passing against a
  // shape the app stopped writing.
  const persona = JSON.parse(readFileSync(manifest, 'utf8'))
  persona.avatarId = 'a-face-that-is-not-there'
  writeFileSync(manifest, JSON.stringify(persona, null, 2))
  return { broke: folders[0].name, why: null }
}

/* ---- the clipboard ------------------------------------------------------ */

/**
 * What is on the clipboard, and how to put it back.
 *
 * A6 is a claim about what reaches the clipboard, so the check has to look
 * there -- and a gate that leaves somebody's clipboard holding a test string is
 * a gate people stop running.
 */
function clipboardNow() {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' })
  } catch {
    return null
  }
}

function setClipboard(text) {
  if (text === null) return
  try {
    execFileSync('pbcopy', { input: text })
  } catch {
    /* Nothing to restore to. Not worth failing the run over. */
  }
}

/**
 * What the window says when there is nothing in it.
 *
 * §2.7 of the brief: "One character and zero conversations. Everything about
 * what has been said is empty until she has been awake and talking. This is
 * most people's first hour."
 *
 * Every other check in this file runs against a seeded profile, deliberately —
 * the last pass of this work passed twenty-two checks against an empty one
 * while six regressions sat on screen. The cost of that correction is that the
 * empty states are now the ones nothing looks at, so this walks them and prints
 * what each place actually says.
 */
async function firstHour(page) {
  console.log('\n  ─── the first hour: one character, nothing said ─────────────')
  for (const place of ['cast', 'archive', 'permits', 'machine']) {
    await page.run(
      `(() => { const t = document.getElementById('${place}' === 'machine' ? 'rail-machine' : 'tab-for-${place}'); if (t) { t.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); t.click(); } })()`,
    )
    await wait(700)
    const said = await page.run(`(() => {
      const words = (el) => (el && el.getClientRects().length > 0 ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
      const reading = [...document.querySelectorAll('#reading > *, #machine-pane')]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => words(e)).filter(Boolean);
      const margin = [...document.querySelectorAll('#margin > *, #machine-tools')]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => words(e)).filter(Boolean);
      return {
        reading: reading.map((t) => t.slice(0, 150)),
        margin: margin.map((t) => t.slice(0, 90)),
        strip: words(document.getElementById('calendar')),
        // VISIBLE children only. Reading the bar's textContent includes the
        // hidden archive controls and reports them on every page.
        status: [...document.querySelectorAll('.status > *')]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => words(e))
          .filter(Boolean)
          .join(' · '),
      };
    })()`)
    console.log(`  ${place}:`)
    if (said.reading.length === 0) console.log('      reading: (NOTHING AT ALL)')
    else for (const t of said.reading) console.log(`      reading: ${t}`)
    if (said.margin.length === 0) console.log('      margin:  (empty)')
    else for (const t of said.margin) console.log(`      margin:  ${t}`)
    if (said.strip !== null) console.log(`      strip:   ${said.strip.slice(0, 90)}`)
    console.log(`      status:  ${said.status}`)
  }
  console.log('  ─────────────────────────────────────────────────────────────\n')
}

/* ---- the sweep ----------------------------------------------------------- */

/**
 * A measured sweep of the whole window, against the delivery's own vocabulary.
 *
 * The checks below are the ones worth failing a build over. This is the other
 * kind: it walks every visible element on every page in both themes and reports
 * every value that is not in the design system — a typeface that is not one of
 * the three, a size that is not a rung of the scale, a radius that is not 0, 3
 * or 6, a shadow at all, a colour that is not a token.
 *
 * It reports rather than fails, because a sweep is how you find out what to
 * check, and a list of forty deviations is not a gate.
 */
async function audit(page) {
  const SIZES = [46, 30, 21, 19, 15.5, 14, 13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5]
  const FACES = ['Literata', 'Sora', 'DM Mono']
  const RADII = ['0px', '3px', '6px', '999px']
  /*
    The one shadow this window is allowed, and why.

    "Hairlines, not shadows" is about structure — an edge is a rule, a surface
    does not lift. The ring around a lit status light is neither: it is what
    makes an 8px dot of colour read as a light rather than as a bullet, and
    `.light` argues for it where it is drawn. Named here so it stops being
    reported, and so the next shadow still is.
  */
  const ALLOWED = ['span.light']

  console.log('\n  ─── the sweep ───────────────────────────────────────────────')
  for (const theme of ['light', 'dark']) {
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }],
    })
    for (const place of ['cast', 'archive', 'permits', 'machine']) {
      await page.run(
        `(() => { const t = document.getElementById('${place}' === 'machine' ? 'rail-machine' : 'tab-for-${place}'); if (t) { t.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); t.click(); } })()`,
      )
      await wait(600)
      const found = await page.run(`(() => {
        const out = { faces: {}, sizes: {}, radii: {}, shadows: {}, colours: {} };
        const note = (bucket, key, who) => {
          if (!out[bucket][key]) out[bucket][key] = [];
          if (out[bucket][key].length < 3) out[bucket][key].push(who);
        };
        const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '');
        for (const el of document.querySelectorAll('body *')) {
          if (el.getClientRects().length === 0) continue;
          const s = getComputedStyle(el);
          const has = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
          if (has) {
            const face = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
            note('faces', face, name(el));
            note('sizes', s.fontSize, name(el));
          }
          const r = s.borderRadius;
          if (r !== '0px') note('radii', r, name(el));
          if (s.boxShadow !== 'none') note('shadows', s.boxShadow.slice(0, 40), name(el));
        }
        return out;
      })()`)

      /*
        Every face is listed, not only the wrong ones.

        A face outside the three is a defect a machine can find. A face that is
        one of the three and doing the WRONG JOB is not: "true whoever is worn"
        was set in Sora — legal, and the treatment for something you operate —
        while it is a note, which this design sets in mono. Nothing measured
        could call that wrong; a person reading the list can.
      */
      if (process.argv.includes('--faces')) {
        for (const face of Object.keys(found.faces)) {
          console.log(`      ${theme}/${place}  ${face}: ${found.faces[face].join(' ')}`)
        }
      }
      const oddFace = Object.keys(found.faces).filter((f) => !FACES.includes(f))
      const oddSize = Object.keys(found.sizes).filter((v) => !SIZES.includes(parseFloat(v)))
      const oddRadius = Object.keys(found.radii).filter((v) => !RADII.includes(v))
      const shadows = Object.keys(found.shadows)
      const lines = []
      for (const f of oddFace) lines.push(`face  ${f}  ${found.faces[f].join(' ')}`)
      for (const v of oddSize) lines.push(`size  ${v}  ${found.sizes[v].join(' ')}`)
      for (const v of oddRadius) lines.push(`radius  ${v}  ${found.radii[v].join(' ')}`)
      for (const v of shadows) {
        const who = found.shadows[v]
        if (who.every((one) => ALLOWED.includes(one))) continue
        lines.push(`shadow  ${v}  ${who.join(' ')}`)
      }
      if (lines.length === 0) console.log(`  ${theme}/${place}: nothing outside the system`)
      else {
        console.log(`  ${theme}/${place}:`)
        for (const line of lines) console.log(`      ${line}`)
      }
    }
  }
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  console.log('  ─────────────────────────────────────────────────────────────\n')
}

/**
 * The room between things, measured rather than looked at.
 *
 * The delivery's rhythm is `4 · 8 · 12 · 16 · 22 · 30 · 40`, and its artboards
 * also use 7, 9, 11, 14, 18, 26 and 34 — so the ladder is a spine, not a
 * whitelist. What a whitelist cannot tell you anyway is the thing that actually
 * reads as sloppy: the SAME relationship spaced differently in two places, and
 * a container whose children are all one distance apart except one.
 *
 * So this reports, per container, the real gaps between consecutive visible
 * children — bottom of one to top of the next — and flags the odd one out.
 */
async function breathing(page) {
  console.log('\n  ─── breathing room ──────────────────────────────────────────')
  for (const place of ['cast', 'archive', 'permits', 'machine']) {
    await page.run(
      `(() => { const t = document.getElementById('${place}' === 'machine' ? 'rail-machine' : 'tab-for-${place}'); if (t) { t.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); t.click(); } })()`,
    )
    await wait(700)
    const rooms = await page.run(`(() => {
      const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
        (e.className && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(' ')[0] : '');
      const out = [];
      const holders = document.querySelectorAll('.rail, #reading, #margin, #margin-hers, #margin-talk, #machine-pane, #machine-tools, #nav-groups, .head, .sheet, .list, #pane, #permits, .subject');
      for (const holder of holders) {
        if (holder.getClientRects().length === 0) continue;
        const kids = [...holder.children].filter((e) => e.getClientRects().length > 0 && !e.hidden);
        if (kids.length < 2) continue;
        const gaps = [];
        for (let i = 0; i < kids.length - 1; i += 1) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[i + 1].getBoundingClientRect();
          // Only stacked pairs; a row's neighbours are a different question.
          if (b.top < a.bottom - 1) continue;
          gaps.push({ px: Math.round(b.top - a.bottom), from: name(kids[i]), to: name(kids[i + 1]) });
        }
        if (gaps.length > 0) out.push({ holder: name(holder), gaps });
      }
      return out;
    })()`)
    console.log(`  ${place}:`)
    for (const room of rooms) {
      const counts = {}
      for (const g of room.gaps) counts[g.px] = (counts[g.px] ?? 0) + 1
      const distinct = Object.keys(counts)
        .map(Number)
        .sort((a, b) => a - b)
      const common = distinct.reduce(
        (best, v) => (counts[v] > (counts[best] ?? 0) ? v : best),
        distinct[0],
      )
      const odd = room.gaps.filter((g) => g.px !== common)
      console.log(
        `      ${room.holder}  ${room.gaps.length} gaps · mostly ${common}px · ${JSON.stringify(counts)}`,
      )
      for (const g of odd.slice(0, 4))
        console.log(`          ${g.px}px between ${g.from} and ${g.to}`)
    }
  }
  console.log('  ─────────────────────────────────────────────────────────────\n')
}

/**
 * Every control, grouped by kind, so the ones that disagree say so.
 *
 * A whitelist of allowed values cannot find this: each of these treatments is
 * defensible on its own, and the defect is that two controls doing the same
 * JOB look different. So this groups by tag and type, prints the distinct
 * treatments inside each group, and lets a group with more than one be the
 * finding.
 */
async function controls(page) {
  console.log('\n  ─── controls ────────────────────────────────────────────────')
  const seen = new Map()
  for (const place of ['cast', 'archive', 'permits', 'machine']) {
    await page.run(
      `(() => { const t = document.getElementById('${place}' === 'machine' ? 'rail-machine' : 'tab-for-${place}'); if (t) { t.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); t.click(); } })()`,
    )
    await wait(650)
    const found = await page.run(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, input, select, textarea')) {
        if (el.getClientRects().length === 0) continue;
        const s = getComputedStyle(el);
        const kind = el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? '[' + el.type + ']' : '');
        const edge = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].join('/');
        const look = [
          'font ' + s.fontFamily.split(',')[0].replace(/["']/g, '') + ' ' + s.fontSize,
          'pad ' + s.padding,
          'edge ' + edge + ' ' + s.borderTopStyle + ' ' + s.borderBottomColor,
          'radius ' + s.borderRadius,
          'fill ' + s.backgroundColor,
        ].join(' · ');
        /*
          The state is part of the key.

          Without it a disabled button and an enabled one read as two treatments
          of the same control — a disabled .btn drops its fill on purpose —
          and the report cried wolf about the one thing it exists to find.
        */
        const state = (el.disabled ? ' disabled' : '') + (el.getAttribute('aria-current') === 'true' ? ' current' : '');
        /*
          Grouped by CLASS, not by tag.

          Every button in this window is a button and they are meant to differ —
          a rail row is not a day cell is not a pill. Reporting them together
          said "13 different treatments" about a window that is working. The
          finding worth having is one CLASS wearing two treatments in the same
          state, which is a thing nobody chose.
        */
        const cls = el.className ? el.className.trim().split(/\\s+/).join('.') : (el.id ? '#' + el.id : kind);
        out.push({ kind: cls + state, cls: kind, look });
      }
      return out;
    })()`)
    for (const one of found) {
      if (!seen.has(one.kind)) seen.set(one.kind, new Map())
      const looks = seen.get(one.kind)
      if (!looks.has(one.look)) looks.set(one.look, new Set())
      looks.get(one.look).add(one.cls)
    }
  }
  /*
    A SIZE is a variant; an edge is a disagreement.

    Two controls at 12px and 10px with the same colours, radius and absence of
    border are one shape used twice — the prompt panel's tabs are the pronoun
    control a size down, because they share a line with a heading, and that is
    written where they are drawn. Two controls where one has a border and the
    other does not are two answers to one question, which is what this exists to
    find. So the size and padding are stripped before the comparison, and the
    variants are printed under their own heading rather than counted as faults.
  */
  const shape = (look) => look.replace(/font [^·]+· pad [^·]+· /, '')
  let odd = 0
  let variants = 0
  for (const [kind, looks] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (looks.size < 2) continue
    const shapes = new Set([...looks.keys()].map(shape))
    if (shapes.size < 2) {
      variants += 1
      console.log(`  ${kind}  ${String(looks.size)} sizes of one shape`)
      for (const look of looks.keys())
        console.log(`      ${look.split(' · ').slice(0, 2).join(' · ')}`)
      continue
    }
    odd += 1
    console.log(`  ${kind}  ${String(looks.size)} TREATMENTS`)
    for (const [look, who] of looks) console.log(`      ${[...who].join(' ')}  ${look}`)
  }
  console.log(
    odd === 0
      ? `  no control disagrees with itself · ${String(seen.size)} kinds, ${String(variants)} with a size variant`
      : `  ${String(odd)} of ${String(seen.size)} kinds disagree with themselves`,
  )
  console.log('  ─────────────────────────────────────────────────────────────\n')
}

/* ---- looking at it ------------------------------------------------------ */

/**
 * A photograph of each place, for a person to look at.
 *
 * The checks below MEASURE; they cannot say whether the window looks like the
 * design it is meant to. That question needs eyes, and the eyes need a
 * populated profile — which this run already has, and which is exactly what a
 * screenshot taken by hand from a fresh profile did not, the time six
 * regressions sat on screen through twenty-two green checks.
 */
async function photograph(page) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const into = join(ROOT, 'dev-docs', 'shots')
  mkdirSync(into, { recursive: true })
  for (const place of ['cast', 'archive', 'permits', 'machine']) {
    await page.run(
      `(() => { const t = document.getElementById('${place}' === 'machine' ? 'rail-machine' : 'tab-for-${place}'); if (t) { t.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); t.click(); } })()`,
    )
    await wait(900)
    const showing = await page.run(
      `[...document.querySelectorAll('.view')].find((v) => v.getAttribute('aria-current') === 'true')?.textContent ?? (document.getElementById('page-machine').hidden ? 'none' : 'machine')`,
    )
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    const data = shot.result?.data
    if (!data) continue
    writeFileSync(join(into, `${place}.png`), Buffer.from(data, 'base64'))
    console.log(`  shot  dev-docs/shots/${place}.png  showing: ${showing}`)
  }
}

/* ---- the checks --------------------------------------------------------- */

/**
 * Every check below is a claim about what the browser DREW, over a profile that
 * has two characters and four conversations on three days. Nothing here
 * re-tests a decision `src/renderer/rules` already holds; these are the ones
 * that need a layout to be wrong.
 */
async function checks(page, where = '') {
  at = where === '' ? '' : `  [${where}]`
  /*
    THE ARCHIVE, explicitly, before anything asks about it.

    These checks used to rely on the window happening to be here — and several
    of them passed while it was not: `querySelectorAll` finds a hidden element
    perfectly well, so a check that counts days counts them on the machine's
    page too. `anchored` is the one that noticed, because a rect is 0×0 when
    nothing is drawn, and that is the difference between asking the DOM and
    asking the window.
  */
  await page.run(`document.getElementById('tab-for-archive').click()`)
  await wait(700)

  /* --- A1: a day with nothing on it is not a button --------------------- */
  const calendar = await page.run(`(() => {
    const days = [...document.querySelectorAll('button.day')];
    const withTalk = days.filter((d) => d.classList.contains('has'));
    const without = days.filter((d) => !d.classList.contains('has'));
    return {
      total: days.length,
      has: withTalk.length,
      pressable: without.filter((d) => !d.disabled && d.getAttribute('aria-disabled') !== 'true').length,
      hasPressable: withTalk.every((d) => !d.disabled),
    };
  })()`)
  if (calendar.has !== 3)
    bad('A1', 'the seeded days did not reach the calendar (expected 3, saw ' + calendar.has + ')')
  else if (calendar.pressable > 0)
    bad('A1', calendar.pressable + ' empty days answer a press with an empty column')
  else if (!calendar.hasPressable) bad('A1', 'a day WITH conversations was not pressable')
  else
    ok(
      'A1',
      'only days with something on them are pressable (' +
        calendar.has +
        ' of ' +
        calendar.total +
        ')',
    )

  /* --- A2: picking a day filters, it does not scroll --------------------- */
  const filtered = await page.run(`(() => {
    const list = document.querySelector('#reading .list');
    const before = { rows: list.querySelectorAll('.entry').length, top: list.scrollTop };
    const days = [...document.querySelectorAll('button.day.has')];
    const other = days.find((d) => d.getAttribute('aria-current') !== 'true');
    if (!other) return { why: 'every day with conversations was already the current one' };
    other.click();
    return { before, other: other.textContent.trim() };
  })()`)
  await wait(700)
  const afterPick = await page.run(`(() => {
    const list = document.querySelector('#reading .list');
    return { rows: list.querySelectorAll('.entry').length, top: list.scrollTop,
             head: (list.querySelector('.picked .what') || {}).textContent || '' };
  })()`)
  if (filtered.why) bad('A2', filtered.why)
  else if (afterPick.rows === 0) bad('A2', 'picking a day with conversations showed none')
  else if (afterPick.top !== filtered.before.top)
    bad('A2', 'picking a day scrolled the list instead of narrowing it')
  else if (!afterPick.head.includes(filtered.other))
    bad(
      'A2',
      'the list still names a different day (' +
        afterPick.head +
        ') after picking ' +
        filtered.other,
    )
  else ok('A2', 'picking narrows to that day (' + afterPick.head + ') without scrolling')

  /* --- nothing is on screen that has not been opened --------------------- */
  const closed = await page.run(`(() => {
    /*
      A popover that is not open must not be drawn — and an author display
      declaration beats the user agent's, so this is checkable only by looking.
    */
    const shut = [...document.querySelectorAll('[popover]')].filter((p) => !p.matches(':popover-open'));
    const drawn = shut.filter((p) => p.getClientRects().length > 0);
    return { shut: shut.length, drawn: drawn.map((p) => '#' + (p.id || '?')) };
  })()`)
  if (closed.shut === 0) bad('closed', 'no popover was found, so this proves nothing')
  else if (closed.drawn.length > 0)
    bad(
      'closed',
      closed.drawn.length + ' closed popovers are on screen: ' + JSON.stringify(closed.drawn),
    )
  else ok('closed', 'all ' + closed.shut + ' closed popovers are off screen')

  /* --- the picker hangs off the button, not off the window --------------- */
  const under = await page.run(`(() => {
    const open = document.querySelector('.daystrip .month');
    open.click();
    const pick = document.getElementById('month-pick');
    const a = open.getBoundingClientRect();
    const b = pick.getBoundingClientRect();
    pick.hidePopover();
    return {
      overlaps: b.left < a.right && b.right > a.left,
      below: b.top >= a.bottom - 1,
      near: Math.round(b.top - a.bottom),
      at: Math.round(b.left) + ',' + Math.round(b.top),
      button: Math.round(a.left) + ',' + Math.round(a.bottom),
    };
  })()`)
  await wait(300)
  if (!under.overlaps)
    bad(
      'anchored',
      'the picker is not under its button: picker at ' +
        under.at +
        ', button at ' +
        under.button +
        ' — a popover is in the top layer, so `position: absolute` resolves against the window',
    )
  else if (!under.below) bad('anchored', 'the picker covers the button it hangs off')
  else if (under.near > 24)
    bad('anchored', 'the picker floats ' + under.near + 'px below its button')
  else ok('anchored', 'the picker opens ' + under.near + 'px under the month it belongs to')

  /* --- the month and the days are one row -------------------------------- */
  const oneRow = await page.run(`(() => {
    const month = document.querySelector('.daystrip .month');
    const numeral = document.querySelector('.strip .day-n');
    if (!month || !numeral) return { why: 'the day strip has no month or no days' };
    const a = month.getBoundingClientRect();
    const b = numeral.getBoundingClientRect();
    return { month: Math.round(a.top), numeral: Math.round(b.top) };
  })()`)
  if (oneRow.why) bad('one-row', oneRow.why)
  else if (Math.abs(oneRow.month - oneRow.numeral) > 4)
    bad(
      'one-row',
      'the month and the days are on different lines: ' +
        oneRow.month +
        ' against ' +
        oneRow.numeral +
        ' — something is padding one of them',
    )
  else ok('one-row', 'the month sits on the same line as the days it names')

  /* --- the month picker opens, takes a year, and moves the strip --------- */
  const picker = await page.run(`(() => {
    const open = document.querySelector('.daystrip .month');
    if (!open) return { why: 'the day strip has no month control' };
    const was = open.textContent.trim();
    open.click();
    const pick = document.getElementById('month-pick');
    if (!pick || !pick.matches(':popover-open')) return { why: 'pressing the month opened nothing' };
    const months = pick.querySelectorAll('.month-one').length;
    const field = pick.querySelector('.month-year');
    if (!field) return { why: 'the picker takes no year' };
    // A year the archive cannot hold: it must refuse and stay put.
    field.value = '20';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const refused = document.querySelector('.daystrip .month').textContent.trim();
    // And one it can: the strip moves.
    document.getElementById('month-pick').showPopover();
    const live = document.querySelector('#month-pick .month-year');
    live.value = '2024';
    live.dispatchEvent(new Event('change', { bubbles: true }));
    const moved = document.querySelector('.daystrip .month').textContent.trim();
    return { was, months, refused, moved, stillOpen: (document.getElementById('month-pick') || {}).matches?.(':popover-open') ?? false };
  })()`)
  await wait(500)
  if (picker.why) bad('month', picker.why)
  else if (picker.months !== 12)
    bad('month', 'the picker offers ' + picker.months + ' months, not 12')
  else if (picker.refused !== picker.was)
    bad('month', 'a year the archive cannot hold moved the strip anyway: ' + picker.refused)
  else if (!/2024/.test(picker.moved))
    bad('month', 'typing a year did not move the strip: ' + picker.moved)
  else if (picker.stillOpen) bad('month', 'the picker stayed open over the strip it had just moved')
  else ok('month', 'opens, refuses "20", moves to ' + picker.moved + ', and closes behind itself')

  /*
    Escape, which is the platform's and has to actually reach it.

    A popover gets this for free and that is the reason for using one — but
    "for free" is a claim about a mechanism, and the mechanism is only in force
    if the element really is a popover and really is open. Both have been true
    and neither was, in this window, an hour ago.
  */
  await page.run(`document.querySelector('.daystrip .month').click()`)
  await wait(400)
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
  }
  await wait(400)
  const gone = await page.run(
    `(() => { const p = document.getElementById('month-pick'); return { open: p.matches(':popover-open'), drawn: p.getClientRects().length > 0 }; })()`,
  )
  if (gone.open || gone.drawn) bad('month', 'Escape did not close the picker')
  else ok('month', 'Escape closes it')

  // Back where the rest of the checks expect it.
  await page.run(`(() => {
    const strip = [...document.querySelectorAll('button.day.has')];
    if (strip.length === 0) {
      const back = document.querySelector('.daystrip .step');
      for (let i = 0; i < 24 && document.querySelectorAll('button.day.has').length === 0; i += 1) {
        document.querySelectorAll('.daystrip .step')[1].click();
      }
    }
  })()`)
  await wait(600)

  /* --- D2/D3: the confirmation, and the order of what it offers ---------- */
  const opened = await page.run(`(() => {
    // Wherever it lives. The archive-wide deletions are reached from the topbar
    // and from the cast, not from inside the archive panel -- scoping this to
    // one panel is how a gate reports a rule unheld when it is simply elsewhere.
    const offers = [...document.querySelectorAll('button')].filter((b) => /forget everything|delete all/i.test(b.textContent));
    if (offers.length === 0) return { why: 'nothing offers a whole-archive deletion' };
    let dialog = null;
    let pressed = '';
    for (const go of offers) {
      go.click();
      dialog = document.querySelector('dialog[open]');
      if (dialog) { pressed = go.textContent.trim(); break; }
    }
    if (!dialog) return { why: 'no destructive control opened a dialog — they arm in place: ' + JSON.stringify(offers.map((b) => b.textContent.trim())) };
    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim());
    return {
      buttons,
      says: (dialog.querySelector('h2') || {}).textContent || '',
      pressed,
      rowsBefore: document.querySelectorAll('#reading .entry').length,
    };
  })()`)
  if (opened.why) {
    bad('D2', opened.why)
    bad('D3', 'not reachable — no dialog opened')
  } else {
    ok('D2', 'confirming happens on a surface of its own ("' + opened.says + '")')
    const destructive = opened.buttons.findIndex((t) => /delete|forget/i.test(t))
    const keepIt = opened.buttons.findIndex((t) => /keep|cancel/i.test(t))
    const copy = opened.buttons.findIndex((t) => /export|copy|save/i.test(t))
    if (destructive === -1) bad('D3', 'the dialog offers no destructive action at all')
    else if (destructive !== opened.buttons.length - 1)
      bad('D3', 'the destructive button is not last: ' + JSON.stringify(opened.buttons))
    else if (copy === -1)
      bad('D3', 'the dialog offers no way to save a copy first: ' + JSON.stringify(opened.buttons))
    else if (copy > destructive) bad('D3', 'the copy is offered after the deletion')
    else if (keepIt === -1) bad('D3', 'the dialog offers no way out')
    else ok('D3', 'safe, then a copy, then the deletion last: ' + JSON.stringify(opened.buttons))

    /* Escape closes it, and nothing is gone. */
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await wait(500)
    const after = await page.run(`({ open: document.querySelectorAll('dialog[open]').length,
                                     rows: document.querySelectorAll('#reading .entry').length })`)
    if (after.open !== 0) bad('D2', 'Escape did not close the confirmation')
    else if (after.rows !== opened.rowsBefore)
      bad(
        'D2',
        'abandoning the confirmation still changed the archive (' +
          opened.rowsBefore +
          ' to ' +
          after.rows +
          ')',
      )
    else ok('D2', 'Escape abandons it with no consequence')
  }

  /* --- D4: no single conversation is deletable in one gesture ------------ */
  const perRow = await page.run(`(() => {
    const rows = [...document.querySelectorAll('#reading .entry')];
    const armed = rows.filter((r) => [...r.querySelectorAll('button, [role=button]')]
      .some((c) => /delete|forget|remove|✕|×/i.test(c.textContent + (c.getAttribute('aria-label') || ''))));
    return { rows: rows.length, armed: armed.length };
  })()`)
  if (perRow.rows === 0) bad('D4', 'no conversation rows were drawn, so this proves nothing')
  else if (perRow.armed > 0) bad('D4', perRow.armed + ' conversation rows carry their own delete')
  else ok('D4', 'no single conversation can be deleted in one gesture (' + perRow.rows + ' rows)')

  /* --- A6: copying takes the original text, not what is on screen ------- */
  const copied = await page.run(`(() => {
    const entry = document.querySelector('#reading .entry');
    if (!entry) return { why: 'no conversation to open' };
    entry.click();
    return { opened: true };
  })()`)
  await wait(900)
  /*
    Read off the real clipboard, and put back what was there.

    Patching `window.mochiHistory.copy` does not work: it is a `contextBridge`
    object and its properties are not writable, so the assignment fails silently
    and the check reports "sent nothing" against a control that works. The
    clipboard is the honest end of this path anyway -- it is what the person
    actually gets.
  */
  const held = clipboardNow()
  let raw
  try {
    setClipboard('')
    raw = await page.run(`(() => {
      const buttons = [...document.querySelectorAll('button')].filter((b) => /copy this turn/i.test(b.getAttribute('aria-label') || ''));
      if (buttons.length === 0) return { why: 'the transcript offers no way to copy a turn' };
      const button = buttons[buttons.length - 1];
      const run = button.closest('.run') || button.parentElement;
      button.click();
      return { onScreen: run ? run.textContent : '' };
    })()`)
    await wait(700)
    if (!raw.why) raw.took = clipboardNow()
  } finally {
    setClipboard(held)
  }
  if (copied.why) bad('A6', copied.why)
  else if (raw.why) bad('A6', raw.why)
  else if (raw.took === null) bad('A6', 'the copy control sent nothing')
  else if (raw.took !== AWKWARD)
    bad('A6', 'copied the rendered form, not the original: ' + JSON.stringify(raw.took))
  else if (raw.onScreen === raw.took)
    bad('A6', 'the rendered form is identical to the raw text, so this proves nothing')
  else ok('A6', 'copying takes the original text, indentation and newline intact')

  /* --- the rail makes characters; it does not remove them --------------- */
  const rail = await page.run(`(() => {
    const make = [...document.querySelectorAll('.rail-make button')].map((b) => b.textContent.trim());
    const railWords = document.querySelector('.rail').textContent;
    const onHerPage = [...document.querySelectorAll('#pane button')].map((b) => b.textContent.trim());
    return { make, removes: /delete|remove/i.test(railWords), onHerPage: onHerPage.filter((t) => /^Delete /.test(t)) };
  })()`)
  if (rail.make.length === 0) bad('rail', 'the rail offers no way to make a character')
  else if (rail.removes)
    bad(
      'rail',
      'the rail offers a deletion: it would act on the WORN character while sitting under a list of all of them — ' +
        JSON.stringify(rail.make),
    )
  else if (rail.onHerPage.length === 0)
    bad('rail', 'no character can be deleted anywhere — it left the rail and arrived nowhere')
  else
    ok(
      'rail',
      'makes characters (' +
        JSON.stringify(rail.make) +
        ') and removes them only from her own page (' +
        JSON.stringify(rail.onHerPage) +
        ')',
    )

  /* --- C4: a character with no face file is not drawn as somebody else --- */
  const faces = await page.run(`(() => {
    const cards = [...document.querySelectorAll('.rail-cast .rail-row')];
    if (cards.length < 2) return { why: 'only ' + cards.length + ' character(s) reached the cast list' };
    const shots = cards.map((c) => {
      const canvas = c.querySelector('canvas');
      const name = (c.querySelector('.rail-name') || {}).textContent || '?';
      const drawn = canvas ? canvas.toDataURL() : 'no canvas';
      const style = canvas ? getComputedStyle(canvas).borderStyle : '';
      return { name, drawn, style, blank: drawn.length < 400 };
    });
    return { shots: shots.map((s) => ({ name: s.name, style: s.style, blank: s.blank })),
             identical: shots[0].drawn === shots[1].drawn };
  })()`)
  if (faces.why) bad('C4', faces.why)
  else if (faces.identical)
    bad('C4', 'the character with no face file is drawn with an identical picture to the built-in')
  else
    ok(
      'C4',
      'a missing face is not silently substituted (' +
        JSON.stringify(faces.shots.map((s) => s.name)) +
        ')',
    )

  /* --- an editable thing looks editable --------------------------------- */
  const editable = await page.run(`(() => {
    const fields = [...document.querySelectorAll('input[type=text], input[type=search], textarea, select')]
      .filter((e) => e.getClientRects().length > 0 && !e.disabled && !e.readOnly);
    const silent = [];
    for (const el of fields) {
      const s = getComputedStyle(el);
      // Something has to say it: a rule under it, a box round it, or a fill
      // that is not the page. Transparent on every side is plain text with a
      // caret hiding in it.
      const edges = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]
        .map(parseFloat);
      const colours = [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
      /*
        Compared as STRINGS, because a regular expression cannot survive the
        trip.

        This was a pattern built inside a template literal, so its backslashes
        were dropped before the page ever saw it: 'rgba\\(0, 0, 0, 0\\)' arrived
        as 'rgba(0, 0, 0, 0)', which is a capture group matching nothing. Every
        edge therefore counted as drawn and the check passed against a window
        where her name had no rule at all — verified by flipping it and watching
        this stay green.
      */
      const clear = (c) => c === 'transparent' || c.split(' ').join('') === 'rgba(0,0,0,0)';
      const ruled = edges.some((w, i) => w > 0 && !clear(colours[i]));
      const filled = !clear(s.backgroundColor);
      /*
        Or its container says it.

        A field can be the word in a sentence — the search box is a caret inside
        a ruled line, and her name and what she calls you are the same shape.
        The rule is on the thing that draws it; requiring it on the input itself
        would fail exactly the treatment this design asks for.
      */
      const parent = el.parentElement;
      let held = false;
      if (parent) {
        const ps = getComputedStyle(parent);
        const pEdges = [ps.borderTopWidth, ps.borderRightWidth, ps.borderBottomWidth, ps.borderLeftWidth].map(parseFloat);
        const pColours = [ps.borderTopColor, ps.borderRightColor, ps.borderBottomColor, ps.borderLeftColor];
        held = pEdges.some((w, i) => w > 0 && !clear(pColours[i])) || !clear(ps.backgroundColor);
      }
      if (!ruled && !filled && !held) {
        silent.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + (el.className || '?'));
      }
    }
    return { seen: fields.length, silent: silent.slice(0, 6),
 };
  })()`)
  if (editable.seen === 0) bad('editable', 'no editable control was drawn, so this proves nothing')
  else if (editable.silent.length > 0)
    bad(
      'editable',
      editable.silent.length +
        ' editable things show no rule, box or fill: ' +
        JSON.stringify(editable.silent),
    )
  else ok('editable', 'all ' + editable.seen + ' editable things say so at rest')

  /*
    C5 stood here: "seeing a mood and permitting it are two separate actions and
    must never be confusable".

    There are no mood tiles. Nothing in this application ever consulted a
    character's expression set to decide what she wears, so the switch changed
    one sentence in her instructions and nothing else — the whole section is
    gone and every character has all eight. A rule with no subject cannot be
    checked, and pretending otherwise is how a suite comes to be full of green
    that means nothing.

    The RULE is not wrong and it is recorded in `rebuild-contract.md`. If a
    control ever offers looking-at and permitting side by side again, this is
    the check it needs.
  */

  /* --- contrast: the floors the app enforces at runtime ------------------ */
  /*
    BOTH themes, because the failure that prompted this gate was present in both
    and a single-theme sweep would have reported half of it as fixed. The pair
    that failed was built-in chrome on built-in chrome, which `applyAccent` does
    not guard -- it checks a CHARACTER's hue against the page.
  */
  const measureContrast = `(() => {
    const lum = (c) => {
      const p = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    };
    const behind = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const alpha = bg.match(/[\\d.]+/g);
        if (bg !== 'transparent' && !(alpha && alpha.length > 3 && Number(alpha[3]) === 0)) return bg;
        node = node.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)';
    };
    const bad = [];
    for (const el of document.querySelectorAll('#reading *, #reading *, #page-machine *')) {
      if (el.getClientRects().length === 0) continue;
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!text) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || Number(style.opacity) < 0.5) continue;
      const size = parseFloat(style.fontSize);
      const heavy = Number(style.fontWeight) >= 700;
      const floor = size >= 24 || (size >= 18.66 && heavy) ? 3 : 4.5;
      const a = lum(style.color), b = lum(behind(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      // No tolerance. getComputedStyle answers rgb in whole numbers and the
      // luminance from them is deterministic, so there is no float noise to
      // absorb -- and a tolerance here is the gate excusing exactly what it
      // exists to catch. The pair that prompted this measured 4.4926:1 and sat
      // inside a 0.05 slack for the life of the token.
      if (ratio < floor) {
        bad.push(
          el.tagName.toLowerCase() + '.' + (el.className || '(none)') +
          ' "' + el.textContent.trim().slice(0, 20) + '" ' +
          ratio.toFixed(2) + ':1 needs ' + floor +
          ' — ' + style.color + ' on ' + behind(el)
        );
      }
    }
    return bad.slice(0, 6);
  })()`
  for (const theme of ['light', 'dark']) {
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }],
    })
    await wait(500)
    const below = await page.run(measureContrast)
    if (below.length > 0)
      bad('contrast', theme + ': ' + below.length + ' below the floor: ' + JSON.stringify(below))
    else ok('contrast', theme + ': every drawn text meets its floor (4.5:1, 3:1 for large)')
  }
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await wait(300)

  /* --- Rule 6: none of her colour on the machine's page ------------------ */
  /*
    "The machine is not her. It gets its own page, its own mark, and NONE OF HER
    COLOUR."

    The first two clauses were built and the third was not: her hue reached
    every control on that page that asks for it, so wearing a different
    character restyled a page whose whole subject is that it is not about a
    character. The Save button of all twenty-seven prompt editors was the
    visible half.

    Her colours are resolved by PROBE rather than read from the sheet — they are
    computed by `applyAccent` from whichever character is worn, so there is no
    literal to compare against. The probe lives outside the page, which is the
    point: it reads the value the rest of the window still has.
  */
  await page.run(`document.getElementById('rail-machine').click()`)
  await wait(700)
  /*
    EVERY GROUP, not the one that happens to be open.

    The first version of this check measured whatever the machine page was
    showing, which is one group of seven — and the twenty-seven Save buttons
    that were the whole reason for it live in the third. Removing the fix left
    it green, which is the only reason it was found: a check that cannot go red
    when the fix is deleted is not a check.
  */
  const groups = await page.run(`document.querySelectorAll('#nav-groups .tab').length`)
  const rule6 = { colours: 0, hit: [], away: false, groups }
  for (let g = 0; g < groups; g += 1) {
    await page.run(
      `(() => { const t = document.querySelectorAll('#nav-groups .tab')[${String(g)}]; if (t) t.click(); })()`,
    )
    await wait(320)
    /*
      A field is measured FOCUSED as well as at rest, because her colour on a
      focus ring is the state that only exists while somebody is typing — the
      one nothing else in this window would ever show.
    */
    await page.run(
      `(() => { const f = document.querySelector('#machine-pane input, #machine-pane textarea, #machine-pane select'); if (f) f.focus(); })()`,
    )
    await wait(160)
    const round = await page.run(`(() => {
      const probe = document.createElement('span');
      probe.style.position = 'fixed';
      probe.style.left = '-9999px';
      document.body.append(probe);
      const hers = new Map();
      for (const name of ['--her', '--her-hover', '--her-wash', '--her-deep', '--ink-brand']) {
        probe.style.color = 'var(' + name + ')';
        const value = getComputedStyle(probe).color;
        if (!hers.has(value)) hers.set(value, name);
      }
      probe.remove();
      const page = document.getElementById('page-machine');
      if (page === null || page.getClientRects().length === 0) return { away: true };
      const group = document.querySelector('#nav-groups .tab[aria-current="true"]');
      const named = group === null ? '?' : group.textContent.trim().slice(0, 22);
      const hit = [];
      const edges = { borderTopColor: 'borderTopWidth', borderRightColor: 'borderRightWidth', borderBottomColor: 'borderBottomWidth', borderLeftColor: 'borderLeftWidth' };
      for (const el of page.querySelectorAll('*')) {
        if (el.getClientRects().length === 0) continue;
        const s = getComputedStyle(el);
        const what = named + ' · ' + (el.className ? el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.') : el.tagName.toLowerCase());
        if (hers.has(s.color) && el.textContent.trim() !== '') hit.push(what + ' text ' + hers.get(s.color));
        if (hers.has(s.backgroundColor)) hit.push(what + ' fill ' + hers.get(s.backgroundColor));
        for (const [colour, width] of Object.entries(edges)) {
          if (hers.has(s[colour]) && parseFloat(s[width]) > 0) hit.push(what + ' edge ' + hers.get(s[colour]));
        }
        if (hers.has(s.outlineColor) && parseFloat(s.outlineWidth) > 0) hit.push(what + ' ring ' + hers.get(s.outlineColor));
      }
      return { colours: hers.size, hit: [...new Set(hit)] };
    })()`)
    if (round.away === true) rule6.away = true
    else {
      rule6.colours = round.colours
      for (const one of round.hit) if (!rule6.hit.includes(one)) rule6.hit.push(one)
    }
  }
  if (rule6.away === true) bad('rule-6', 'the machine page is not showing, so nothing was measured')
  else if (rule6.hit.length > 0)
    bad(
      'rule-6',
      rule6.hit.length +
        ' things on the machine page are drawn in her colour: ' +
        JSON.stringify(rule6.hit.slice(0, 6)),
    )
  else
    ok(
      'rule-6',
      'none of her ' +
        rule6.colours +
        ' colours is drawn on any of the machine\u2019s ' +
        rule6.groups +
        ' groups',
    )
  await page.run(`document.getElementById('tab-for-archive').click()`)
  await wait(600)

  /* --- if anything moves, reduced motion stills it ---------------------- */
  const moving = await page.run(`(() => [...document.querySelectorAll('*')]
    .filter((e) => e.getClientRects().length > 0)
    .filter((e) => {
      const s = getComputedStyle(e);
      return parseFloat(s.transitionDuration) > 0 || parseFloat(s.animationDuration) > 0;
    }).length)()`)
  if (moving === 0) {
    // Vacuous today and deliberately not a failure: this shell declares no
    // transitions at all. The check is here so that the first one added has to
    // answer for itself rather than shipping unguarded.
    ok('reduced-motion', 'nothing declares motion, so there is nothing to still')
  } else {
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await wait(400)
    const stilled = await page.run(`(() => [...document.querySelectorAll('*')]
      .filter((e) => e.getClientRects().length > 0)
      .filter((e) => {
        const s = getComputedStyle(e);
        return parseFloat(s.transitionDuration) > 0 || parseFloat(s.animationDuration) > 0;
      }).map((e) => e.tagName.toLowerCase() + '.' + e.className).slice(0, 5))()`)
    await page.send('Emulation.setEmulatedMedia', { features: [] })
    if (stilled.length > 0)
      bad(
        'reduced-motion',
        stilled.length + ' still move when the system asks not to: ' + JSON.stringify(stilled),
      )
    else ok('reduced-motion', moving + ' moving things, all stilled when asked')
  }

  /* --- if anything declares a drag region, its controls opt out ---------- */
  const drag = await page.run(`(() => {
    const dragging = [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).webkitAppRegion === 'drag');
    if (dragging.length === 0) return { none: true };
    const stuck = [];
    for (const bar of dragging) {
      for (const live of bar.querySelectorAll('button, a, input, select, [role=tab]')) {
        if (live.getClientRects().length === 0) continue;
        if (getComputedStyle(live).webkitAppRegion !== 'no-drag') stuck.push(live.textContent.trim().slice(0, 16));
      }
    }
    return { regions: dragging.length, stuck: stuck.slice(0, 5) };
  })()`)
  if (drag.none) {
    // This window is frameless and the operating system draws its controls; no
    // element claims a drag region. Stated rather than skipped, so that adding
    // one later is a decision somebody made and not a silent change.
    ok('one-title-bar', 'the window declares no drag region of its own')
  } else if (drag.stuck.length > 0) {
    bad(
      'one-title-bar',
      drag.stuck.length +
        ' controls in a drag region do not opt out: ' +
        JSON.stringify(drag.stuck),
    )
  } else {
    ok('one-title-bar', drag.regions + ' drag region(s), every control in them opts out')
  }
}

/**
 * The checks that are purely about WIDTH, run at more than one width.
 *
 * Split out because the rest have state — A6 opens a conversation and reads the
 * clipboard, A2 picks a day — and running those twice makes each pass depend on
 * what the previous one left behind. These touch nothing.
 */
async function layoutChecks(page, where = '') {
  at = where === '' ? '' : `  [${where}]`
  /* --- a control whose own label does not fit in it ---------------------- */
  const squashed = await page.run(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, select, input, textarea, .name, .worn, .what')) {
      if (el.getClientRects().length === 0) continue;
      /*
        A control's own LABEL has to fit. Its VALUE does not.

        A text field holding a folder path is meant to scroll inside its box —
        that is what a text field is — and flagging it makes this check fire on
        user data rather than on layout. A textarea was excluded for exactly
        this reason and the single-line fields belong with it; buttons and
        selects keep the check, because their text is a label the layout chose.
      */
      if (el.tagName === 'TEXTAREA') continue;
      if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range'].includes(el.type)) continue;
      // The objective form of "no control under half the width of its own
      // cell": its own text does not fit inside it. A narrow control in a wide
      // panel is a layout choice; a control whose label is cut off is not.
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'auto') {
        // The element as well as its words: a control whose label is empty
        // reports as ' needs 667 has 205', which names nothing.
        out.push(
          el.tagName.toLowerCase() + '.' + (el.className || '(none)') +
          (el.id ? '#' + el.id : '') +
          (el.placeholder ? ' [' + el.placeholder.slice(0, 24) + ']' : '') +
          (el.parentElement ? ' in .' + (el.parentElement.className || '?') : '') +
          ' "' + el.textContent.trim().slice(0, 20) + '" needs ' + el.scrollWidth + ' has ' + el.clientWidth
        );
      }
    }
    return out.slice(0, 6);
  })()`)
  if (squashed.length > 0 && process.argv.includes('--why')) {
    const why = await page.run(`(() => {
      const over = [...document.querySelectorAll('button, select, input, textarea, .name, .worn, .what')]
        .filter((e) => e.getClientRects().length > 0 && e.tagName !== 'TEXTAREA')
        .find((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'auto');
      if (!over) return ['nothing over now'];
      const out = [];
      let n = over;
      while (n && n !== document.body) {
        out.push(n.tagName.toLowerCase() + '.' + (n.className || '?') + (n.id ? '#' + n.id : '') +
          ' w=' + Math.round(n.getBoundingClientRect().width) + ' scroll=' + n.scrollWidth + ' client=' + n.clientWidth +
          ' hidden=' + n.hidden);
        n = n.parentElement;
      }
      return out;
    })()`)
    console.log('  why:\n   ' + why.join('\n   '))
  }
  if (squashed.length > 0)
    bad('fits', squashed.length + ' controls cut off their own label: ' + JSON.stringify(squashed))
  else ok('fits', 'every control and name fits the width it is given')

  /* --- nothing clips out of the window ---------------------------------- */
  const clipped = await page.run(`(() => {
    const room = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('#reading *, #reading *, #page-machine *')) {
      if (el.getClientRects().length === 0) continue;
      // Each element's own box: asking the document for scrollWidth is answered
      // by the containing block, and a pane with layout containment answers the
      // window's width however far its children overflow.
      const box = el.getBoundingClientRect();
      if (box.right > room + 1) out.push(el.tagName.toLowerCase() + '.' + el.className + ' to ' + Math.round(box.right) + ' of ' + room);
    }
    return out.slice(0, 5);
  })()`)
  if (clipped.length > 0 && process.argv.includes('--why')) {
    const why = await page.run(`(() => {
      const out = [];
      for (const g of document.querySelectorAll('.machine-spread, .spread')) {
        if (g.getClientRects().length === 0) continue;
        out.push(g.className + ' w=' + Math.round(g.getBoundingClientRect().width) + ' cols=' + getComputedStyle(g).gridTemplateColumns);
        for (const kid of g.children) {
          const b = kid.getBoundingClientRect();
          out.push('  ' + kid.tagName.toLowerCase() + '.' + kid.className + ' x=' + Math.round(b.x) + ' w=' + Math.round(b.width) + ' right=' + Math.round(b.right));
        }
      }
      return out;
    })()`)
    console.log('  why:\n   ' + why.join('\n   '))
  }
  if (clipped.length > 0)
    bad('clipping', clipped.length + ' elements run past the window: ' + JSON.stringify(clipped))
  else ok('clipping', 'nothing is drawn past the right edge of the window')
  at = ''
}

/* ---- the run ------------------------------------------------------------ */

const failures = []
const passes = []
let at = ''
function ok(rule, what) {
  passes.push(`${rule} — ${what}`)
  console.log(`  ok    ${rule}  ${what}${at}`)
}
function bad(rule, what) {
  failures.push(`${rule} — ${what}${at}`)
  console.log(`  FAIL  ${rule}  ${what}${at}`)
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'mochi-rendered-'))
  let running = null
  try {
    /* --- first launch: let the app build its store, and make a character --- */
    running = launch(userData)
    let page = await openShell()
    // Through the same bridge the Duplicate control calls. The control opens a
    // naming step first, and a gate that drove it would be testing the naming
    // step rather than seeding -- what is wanted here is a second character on
    // disk, in whatever shape this build writes one.
    const made = await page.run(
      `window.mochiHistory.character({ kind: 'duplicate', name: 'Wisp' }).then((r) => JSON.stringify(r))`,
    )
    await wait(3000)
    const listed = await page.run(`document.querySelectorAll('.rail .rail-row').length`)
    page.close()
    await stop(running)
    running = null
    if (process.argv.includes('--look'))
      console.log('  seeded character:', made, '| cards now:', listed)
    running = null

    /* --- seed, unless we are auditing the first hour --- */
    /*
      `--fresh` leaves the store as the app made it: one character, nothing
      said, no avatar named. That is §2.7 of the brief — "most people's first
      hour" — and it is the state every check here has been blind to, because
      seeding is what made the other checks mean anything.
    */
    const fresh = process.argv.includes('--fresh')
    if (!fresh) seedConversations(userData)
    const face = fresh ? { broke: 'skipped', why: null } : breakAFace(userData)
    // Loudly, and before anything is checked. If the second character never got
    // a face to lose, C4 below is measuring a case this run never created --
    // and a check that cannot fail for the right reason is worse than none.
    if (face.broke === null) {
      console.log(`  FAIL  seed  could not set up the missing-face case: ${face.why}`)
      failures.push('seed')
    }

    /* --- second launch: a populated window --- */
    running = launch(userData)
    page = await openShell()
    await wait(1200)

    if (fresh) {
      await firstHour(page)
      page.close()
      return
    }
    if (process.argv.includes('--audit')) await audit(page)
    if (process.argv.includes('--space')) await breathing(page)
    if (process.argv.includes('--controls')) await controls(page)
    if (process.argv.includes('--rail')) {
      await page.run(`document.getElementById('rail-machine').click()`)
      await wait(700)
      const seen = await page.run(`(() => {
        const of = (sel) => {
          const e = document.querySelector(sel);
          if (!e || e.getClientRects().length === 0) return sel + ': not drawn';
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return sel + '  x=' + Math.round(b.x) + '..' + Math.round(b.right) +
            '  y=' + Math.round(b.y) + '..' + Math.round(b.bottom) +
            '  bg=' + s.backgroundColor + '  pad=' + s.padding;
        };
        return ['.rail', '.rail-foot', '.rail-rule', '#rail-machine', '.rail-says', '.status', '.frame'].map(of);
      })()`)
      console.log('\n  ' + seen.join('\n  ') + '\n')
    }
    if (process.argv.includes('--edges')) {
      await page.run(`document.getElementById('tab-for-archive').click()`)
      await wait(700)
      await page.run(`document.querySelector('.daystrip .month').click()`)
      await wait(500)
      const seen = await page.run(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.getClientRects().length === 0) continue;
          const s = getComputedStyle(el);
          const styles = [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle];
          const colours = [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
          const dashed = styles.some((v) => v === 'dashed' || v === 'dotted');
          const reddish = colours.some((c) => {
            const n = (c.match(/[0-9.]+/g) || []).map(Number);
            return n.length >= 3 && n[0] > 140 && n[0] > n[1] + 40 && n[0] > n[2] + 40;
          });
          const outline = s.outlineStyle !== 'none' && s.outlineWidth !== '0px';
          if (!dashed && !reddish && !outline) continue;
          const b = el.getBoundingClientRect();
          out.push(
            el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + (el.className || '?') +
            '  border=' + s.border + '  outline=' + s.outline +
            '  box=' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height)
          );
        }
        return out.slice(0, 8);
      })()`)
      console.log(
        '\n  ' + (seen.length ? seen.join('\n  ') : 'nothing dashed, red or outlined') + '\n',
      )
    }
    if (process.argv.includes('--pick')) {
      await page.run(`document.getElementById('tab-for-archive').click()`)
      await wait(700)
      const seen = await page.run(`(() => {
        const p = document.getElementById('month-pick');
        const s = getComputedStyle(p);
        const b = p.getBoundingClientRect();
        return 'before any click — open=' + p.matches(':popover-open') +
          '  display=' + s.display + '  drawn=' + (p.getClientRects().length > 0) +
          '  box=' + Math.round(b.width) + 'x' + Math.round(b.height);
      })()`)
      console.log('\n  ' + seen + '\n')
    }
    if (process.argv.includes('--strip')) {
      await page.run(`document.getElementById('tab-for-archive').click()`)
      await wait(700)
      const seen = await page.run(`(() => {
        const of = (sel) => {
          const e = document.querySelector(sel);
          if (!e) return sel + ': none';
          const b = e.getBoundingClientRect();
          return sel + '  x=' + Math.round(b.x) + '  y=' + Math.round(b.y) + '..' + Math.round(b.bottom) + '  h=' + Math.round(b.height);
        };
        return ['.daystrip', '.daystrip .head', '.daystrip .month', '.strip', '.strip .day', '.strip .day-n', '#count'].map(of);
      })()`)
      console.log('\n  ' + seen.join('\n  ') + '\n')
    }
    if (process.argv.includes('--open-month')) {
      await page.run(`(() => { document.getElementById('tab-for-archive').click(); })()`)
      await wait(700)
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: 1820,
        height: 1180,
        deviceScaleFactor: 0,
        mobile: false,
      })
      await wait(600)
      await page.run(`document.querySelector('.daystrip .month').click()`)
      await wait(500)
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync(join(ROOT, 'dev-docs', 'shots'), { recursive: true })
      const shot = await page.send('Page.captureScreenshot', { format: 'png' })
      if (shot.result?.data) {
        writeFileSync(
          join(ROOT, 'dev-docs', 'shots', 'picker.png'),
          Buffer.from(shot.result.data, 'base64'),
        )
        console.log('  shot  dev-docs/shots/picker.png')
      }
      page.close()
      return
    }
    if (process.argv.includes('--shot')) await photograph(page)
    /*
      Checked at the WINDOW'S FLOOR as well as at its opening size.

      Every layout failure this gate has caught was a width failure, and the
      opening size on a large display is the one width at which nothing is
      tight. `window.ts` enforces 1100×700; a check that never sees it is a
      check that passes on the developer's monitor.
    */
    await checks(page)
    await layoutChecks(page)
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 700,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await wait(800)
    await layoutChecks(page, 'at the 1100px floor')
    await page.send('Emulation.clearDeviceMetricsOverride')

    page.close()
  } finally {
    if (running) await stop(running)
    rmSync(userData, { recursive: true, force: true })
  }
  console.log(
    failures.length ? `\n${failures.length} failed` : `\n${passes.length} checks, all green`,
  )
  process.exit(failures.length ? 1 : 0)
}

const watchdog = setTimeout(() => {
  console.error('\nthe gate ran past 4 minutes — failing rather than hanging')
  process.exit(1)
}, 240_000)
watchdog.unref()
await main()
