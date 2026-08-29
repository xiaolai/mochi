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

  /* --- C5: seeing a mood and permitting it are separate controls --------- */
  const moods = await page.run(`(() => {
    const tiles = [...document.querySelectorAll('#reading .mood')];
    if (tiles.length === 0) return { why: 'no mood tiles were drawn' };
    const wrapped = tiles.filter((t) => [...t.querySelectorAll('label')].some((l) => l.querySelector('button, label')));
    const confusable = tiles.filter((t) => {
      const see = t.querySelector('.mood-try, button');
      const allow = t.querySelector('input[type=checkbox]');
      return !see || !allow || see.contains(allow);
    });
    return { tiles: tiles.length, wrapped: wrapped.length, confusable: confusable.length };
  })()`)
  if (moods.why) bad('C5', moods.why)
  else if (moods.wrapped > 0)
    bad(
      'C5',
      moods.wrapped +
        ' mood tiles nest a control inside a label — invalid, and it swallows the click',
    )
  else if (moods.confusable > 0)
    bad('C5', moods.confusable + ' mood tiles make seeing and permitting the same gesture')
  else ok('C5', 'seeing a mood and permitting it are separate in all ' + moods.tiles + ' tiles')

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
        bad.push(el.className + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2) + ':1 needs ' + floor);
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

    /* --- seed --- */
    seedConversations(userData)
    const face = breakAFace(userData)
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
