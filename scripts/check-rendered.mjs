#!/usr/bin/env node
/**
 * The rendered gate: what the window actually DRAWS, checked against a
 * populated profile.
 *
 * ## Running it
 *
 *     pnpm verify:rendered            build, then every check
 *     pnpm rendered                   every check, against the last build
 *     pnpm rendered --list            the names, and nothing else
 *     pnpm rendered --only fits,A6    just those
 *     pnpm rendered --grep rail       everything whose name matches
 *     pnpm rendered --outline         also dump all 14 screens for diffing
 *     pnpm rendered --film            record the run as dev-docs/artifacts/rendered-gate.mp4
 *
 * A filtered run means the same thing as a full one — every check names the page
 * it wants and `goTo` waits for that page to arrive. It did not always: nine
 * `goTo` calls served eighteen checks, so a check measured whatever the run
 * before it left up, and `editable` was caught reporting 1 control, then 0, then
 * 1. Under that arrangement a filter lies, and a filter that lies is worse than
 * no filter.
 *
 * It costs about four seconds to launch, seed and tear down whatever you ask
 * for, and about a tenth of a second per check on top. So `--only` takes a run
 * from seven seconds to four, and no filter will do better than four: the floor
 * is Electron starting twice and giving its debugging port back, not the checks.
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
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'
import { get as httpGet } from 'node:http'
/*
 * `wait` is for the things that are genuinely about elapsed time — an OS
 * releasing a port, a process dying. Anything about the WINDOW uses `settle` or
 * `until` below, which ask it instead of guessing.
 *
 * Measured before that split: 22.9s of a 23.8s run was spent inside this
 * function. Ninety-six per cent of the gate was a sleep, and none of the numbers
 * were measurements — each was somebody's "long enough on my machine", which is
 * the same guess that makes a suite flaky on a slower one.
 */
const wait = sleep

/**
 * Which checks this run is for.
 *
 * `--only a,b` names them; `--grep rail` matches the name. Neither is given by
 * default and everything runs, which is what CI wants.
 *
 * ## Why a filter is safe HERE and would not have been before
 *
 * These checks used to share the window's state: nine `goTo` calls served
 * eighteen named checks, so a check often measured the page some earlier one had
 * left up. Under that arrangement a filter LIES — `--only x` puts the window in
 * a different state than a full run does, so it can pass where the full run
 * fails, which is worse than having no filter at all. `editable` was caught
 * doing exactly this: it reported 1 control, then 0, then 1, depending on how
 * the run before it landed.
 *
 * Every check names the page it wants now, and `goTo` waits for that page to
 * actually arrive. That is what makes a subset mean the same thing as the whole.
 */
const wanted = (() => {
  const only = argOf('--only')
  const grep = argOf('--grep')
  if (only === null && grep === null) return () => true
  const names =
    only === null
      ? []
      : only
          .split(',')
          .map((one) => one.trim())
          .filter(Boolean)
  const pattern = grep === null ? null : new RegExp(grep, 'i')
  return (name) => names.includes(name) || (pattern !== null && pattern.test(name))
})()

function argOf(flag) {
  const at = process.argv.indexOf(flag)
  if (at === -1) return null
  const value = process.argv[at + 1]
  return value === undefined || value.startsWith('--') ? null : value
}

/**
 * Run one check, unless this run is not for it.
 *
 * The name is the one it reports under, so `--only rail-lines-up` and the line
 * it prints are the same string — a filter you can build by copying a failure.
 */
/*
  ---- `--film`: the gate, recorded --------------------------------------------

  A screen recording scoped to the WINDOW rather than to the desktop. Frames
  come from `Page.captureScreenshot` over the same debugging connection the
  checks drive the app through, so what is filmed is exactly what is being
  asserted on — and nothing else that happens to be on the screen. There is no
  permission prompt and nobody's other windows are in it.

  Captions are composited here rather than burned by ffmpeg: this build has
  neither `drawtext` nor `subtitles`, and `@napi-rs/canvas` is already a
  dependency of the test rig. Drawing them makes the type match the application
  as well.

  Each check is held on screen for a minimum number of frames. The whole gate
  takes about seven seconds, which is a fine thing for a gate to be and an
  unreadable thing to watch — so the recording trades real time for legibility
  and says so on the last card.
*/
const FILMING = process.argv.includes('--film')
/** Where frames accumulate, and what was running when each was taken. */
const film = { page: null, frames: [], label: 'starting up', timer: null }

function filmNow(label) {
  film.label = label
}

async function filmFrame() {
  if (film.page === null) return
  try {
    const shot = await film.page.send('Page.captureScreenshot', { format: 'png' })
    const data = shot.result?.data
    if (typeof data === 'string') {
      film.frames.push({ data, label: film.label, passed: passes.length })
    }
  } catch {
    /* a frame missed while a page navigates is not worth failing a run over */
  }
}

/** Start filming whatever this page shows. Called once the shell is open. */
function filmOn(page) {
  if (!FILMING) return
  film.page = page
  film.timer = setInterval(() => void filmFrame(), 150)
}

async function filmOff() {
  if (!FILMING) return null
  if (film.timer !== null) clearInterval(film.timer)
  film.page = null
  if (film.frames.length === 0) return null

  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const scratch = join(ROOT, 'dev-docs', 'artifacts', '.film')
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  /*
    HOLD EACH CHECK, so a seven-second run is watchable.

    Frames arrive on a timer, so a check that finishes in 80ms may own one frame
    or none. Repeating the last frame of each label until it has been on screen
    for the best part of a second is what turns a blur into something a room can
    read — and it is honest, because nothing is invented: the same frame is
    simply held.
  */
  const HOLD = 6
  const held = []
  for (const frame of film.frames) {
    const last = held[held.length - 1]
    if (last !== undefined && last.label !== frame.label) {
      const shortfall = HOLD - held.filter((one) => one.label === last.label).length
      for (let i = 0; i < shortfall; i += 1) held.push(last)
    }
    held.push(frame)
  }

  const first = await loadImage(Buffer.from(held[0].data, 'base64'))
  /*
    The bar is sized for a PROJECTOR, not for this screen.

    Frames come off a retina window at 2560 wide and the video is scaled to 1280
    for sharing, so anything drawn here is halved before anybody sees it. A
    26px caption became 13px in the file — legible on the machine that made it
    and useless in a room, which is the only place this recording is for.
  */
  const BAR = 150
  const width = first.width
  const height = first.height + BAR
  let index = 0
  for (const frame of held) {
    const image = await loadImage(Buffer.from(frame.data, 'base64'))
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#14161c'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0)
    ctx.fillStyle = '#8a8f98'
    ctx.font = '34px sans-serif'
    ctx.fillText('rendered gate — the window, driven and asserted on', 40, first.height + 52)
    ctx.fillStyle = '#e7e7ea'
    ctx.font = '600 62px sans-serif'
    ctx.fillText(frame.label, 40, first.height + 118)
    // The tally at the moment the frame was taken, right-aligned so it does not
    // move as the name beside it changes length.
    ctx.fillStyle = '#7fb08d'
    ctx.font = '38px sans-serif'
    const tally = `${String(frame.passed)} passed`
    ctx.fillText(tally, width - 40 - ctx.measureText(tally).width, first.height + 118)
    writeFileSync(
      join(scratch, `${String(index).padStart(5, '0')}.png`),
      canvas.toBuffer('image/png'),
    )
    index += 1
  }

  const into = join(ROOT, 'dev-docs', 'artifacts')
  mkdirSync(into, { recursive: true })
  const out = join(into, 'rendered-gate.mp4')
  execFileSync(
    'ffmpeg',
    // prettier-ignore
    ['-y', '-loglevel', 'error', '-framerate', '10',
     '-i', join(scratch, '%05d.png'),
     // Halved for sharing. `-2` keeps the height even, which h264 requires.
     '-vf', 'scale=1280:-2',
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out],
  )
  rmSync(scratch, { recursive: true, force: true })
  return { out, frames: held.length, seconds: (held.length / 10).toFixed(1) }
}

async function step(...names) {
  const run = names.pop()
  /*
    `--list` prints the names and runs nothing, so a filter can be built by
    reading rather than by grepping the source for a string literal.
  */
  filmNow(names.join(', '))
  if (LISTING) {
    // Deduped: `layoutChecks` runs twice, at the default width and at the
    // 1120px floor, so its two names would otherwise be printed twice.
    const line = names.join(', ')
    if (!listed.includes(line)) {
      listed.push(line)
      console.log(`  ${line}`)
    }
    return
  }
  if (!names.some((name) => wanted(name))) {
    skipped.push(...names)
    return
  }
  await run()
}

const LISTING = process.argv.includes('--list')
const listed = []

const skipped = []

// A port of its own per run, so two gates -- or a stray from a killed run --
// cannot answer for each other. A fixed port is how a run silently attaches to
// somebody else's window and reports on a profile it never seeded.
const PORT = 9300 + (process.pid % 600)
const ROOT = process.cwd()

/* ---- talking to the window ---------------------------------------------- */

/**
 * Go to one of the four places, and SAY SO when it is not there.
 *
 * This was `if (t) { … }`, written out five times. A guard that shrugs is
 * exactly the wrong default here, and the failure mode is the quiet one this
 * file warns about elsewhere: `querySelectorAll` finds nothing wrong on a page
 * that never opened, so a missed click does not fail — it makes every check
 * after it measure the page that was ALREADY showing and report it as clean.
 * Four places sweep as one, in both themes, and the output is indistinguishable
 * from a pass.
 *
 * The ids are built in `main.ts` from `VIEWS` in `tabs.ts` — `tab-for-cast`,
 * `tab-for-archive`, `tab-for-permits` — and the machine is reached from the
 * rail instead. Renaming a view id is what breaks this, which is why it shouts
 * rather than skipping: a rename is cheap to make and expensive to notice.
 */
/**
 * Let the window finish what a click started, by asking IT rather than by
 * guessing how long it takes.
 *
 * Two animation frames: the first is the one the click's own handler renders
 * in, the second is the one anything that handler scheduled renders in. Then a
 * short grace for the round trips a handler may have started — a settings write
 * answers over IPC and redraws when it lands, and no number of frames can know
 * about that.
 *
 * It replaces `await wait(300)` … `await wait(600)`, of which this file had
 * twenty-two. Those were not measurements of anything: 96% of a 23.8s run was
 * spent inside `sleep`, and every one of those numbers was somebody's guess at
 * "long enough on my machine", which is the same guess that makes a suite flaky
 * on a slower one. Frames are the thing actually being waited for.
 */
/*
  RACED AGAINST A TIMER, because frames are not guaranteed to arrive at all.

  `requestAnimationFrame` does not fire in a window Chromium considers hidden or
  occluded — another window laid over this one, the display asleep, a Space
  switched away. The gate drives a REAL window on a REAL desktop, so that is not
  a rare condition, it is whatever else the machine happens to be doing.

  Two rAFs plus `awaitPromise: true` therefore had a state with no exit: frames
  stopped, the promise never resolved, `Runtime.evaluate` never replied, and the
  whole run stalled at whichever check happened to be in flight. Measured on
  2026-08-31 at roughly one run in five, dying at check 6 once and check 26
  another time — the randomness is what says it belongs to the window's
  visibility rather than to any check.

  The frames are still the thing waited for, and still win whenever they come:
  the fast path is unchanged at about 93ms. The timer only decides what happens
  when they do not. It is deliberately 20x the frame path, so a merely SLOW
  machine still settles on frames rather than being quietly switched to a fixed
  sleep — which is the guess this function was written to get away from.

  Measurements survive the fallback. `getBoundingClientRect` and
  `getComputedStyle` are answered from layout, and layout runs whether or not
  anything is painted; it is the paint that stops.
*/
async function settle(page) {
  await page.run(
    `Promise.race([` +
      `new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => ` +
      `setTimeout(() => done('frames'), 60)))), ` +
      `new Promise((done) => setTimeout(() => done('unpainted'), 2000))` +
      `])`,
  )
}

/**
 * Poll the page until it says yes, or give up loudly.
 *
 * For the waits that are about a CONDITION rather than about rendering — a page
 * having actually arrived, a popover having actually opened. A fixed sleep
 * answers "probably by now"; this answers "yes, and it took 34ms".
 *
 * Throws rather than returning false. Every caller here is establishing the
 * state a measurement is about to be taken in, and a caller that carried on
 * would measure the previous state and report it as this one's — which is the
 * exact defect `goTo` already shouts about.
 */
async function until(page, expression, what, ms = 4000) {
  const deadline = Date.now() + ms
  for (;;) {
    if (
      (await page.run(`(() => { try { return !!(${expression}) } catch { return false } })()`)) ===
      true
    ) {
      return
    }
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what} after ${String(ms)}ms`)
    await sleep(25)
  }
}

async function goTo(page, place) {
  const id = place === 'machine' ? 'rail-machine' : `tab-for-${place}`
  const reached = await page.run(
    `(() => { const t = document.getElementById('${id}'); if (!t) return false;` +
      ` t.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); t.click(); return true; })()`,
  )
  if (reached !== true) {
    throw new Error(
      `cannot reach "${place}": #${id} is not in the document. Every check after ` +
        `this one would have measured whichever page was already showing and passed.`,
    )
  }
  /*
    AND WAIT FOR IT TO ARRIVE, here rather than in each caller.

    Every caller followed this with a sleep of its own — 200, 300, 400, 600 —
    because clicking a tab does not paint the page it opens. The condition is
    knowable: the control marks itself current when the view it opens is up. So
    the wait belongs to the navigation, once, and it is over when the window
    says it is instead of when a number somebody picked runs out.
  */
  await until(
    page,
    `document.getElementById('${id}').getAttribute('aria-current') === 'true'`,
    `${place} to open`,
  )
  await settle(page)
}

/**
 * `node:http` rather than `fetch`, and that is not a style preference.
 *
 * This crashed a release. `fetch` is undici, and undici sets IP_TOS on its
 * socket; on a macOS runner that call came back EINVAL and undici THREW —
 * from inside a socket event handler, which is nowhere near the promise this
 * function returns:
 *
 *     Error: setTypeOfService EINVAL
 *         at Socket.setTypeOfService (node:net:684:13)
 *         at writeH1 (undici:8006:16)
 *         at Socket.emit (node:events:509:28)
 *
 * `waitForTarget` already wraps this in `try/catch` and continues, and that
 * catch is useless against it: an exception raised in an emitter callback is an
 * uncaught exception, not a rejected promise. So a poll that is EXPECTED to fail
 * — it runs up to 300 times a launch while the app is still starting — took the
 * whole process down instead of looping.
 *
 * The symptom was as misleading as it gets. All 38 checks had already printed
 * `ok`; the run died before the summary line, so the gate reported failure over
 * a green suite, and the release stopped with every artifact already built.
 *
 * `node:http` never calls `setTypeOfService`. Every failure it can have arrives
 * as an `error` event or a timeout, both of which land in the `reject` below and
 * therefore in the caller's `catch`, which is where a failing poll belongs.
 */
function listTargets() {
  return new Promise((resolve, reject) => {
    const request = httpGet({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`/json/list answered ${String(response.statusCode)}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (body += chunk))
      response.on('error', reject)
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('error', reject)
    // The app may not be listening yet, and a socket that neither connects nor
    // refuses would hold a poll open past the loop that is counting them.
    request.setTimeout(2_000, () => request.destroy(new Error('/json/list did not answer in 2s')))
  })
}

/*
  Polled every 100ms rather than every 500.

  The budget is unchanged — `tries` is scaled by the same five — so nothing
  times out sooner. What changes is how long after the target appears this
  notices: up to half a second, five times a run, for a target that is usually
  there on the first look.
*/
async function waitForTarget(match, tries = 300) {
  for (let i = 0; i < tries; i += 1) {
    await wait(100)
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

/*
  How long one debugging request may go unanswered before it is a hang.

  A HANG DETECTOR, not a performance budget. Every call under it is a
  `Runtime.evaluate` over a laid-out window or an `Emulation.*` toggle, and those
  answer in single-digit milliseconds; the heaviest thing here is a full-page
  screenshot at 1600px, which is still comfortably under a second. Thirty seconds
  is far enough above the real work that tripping it means no answer is coming,
  and far enough below `BUDGET_MS` that the failing METHOD gets named instead of
  the whole run dying anonymously at four minutes.
*/
const CDP_TIMEOUT_MS = 30_000
/** Connecting is a different wait: the app is still starting. */
const CDP_CONNECT_MS = 60_000

async function attach(target) {
  const { default: WS } = await import('ws')
  const ws = new WS(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    // The connect had no timeout either, and an app that starts without ever
    // accepting the socket left this awaiting forever — before the watchdog was
    // armed, that was the silent exit 13 with no output at all.
    const timer = setTimeout(
      () => rej(new Error(`the debugging socket never opened in ${CDP_CONNECT_MS / 1000}s`)),
      CDP_CONNECT_MS,
    )
    ws.onopen = () => {
      clearTimeout(timer)
      res()
    }
    ws.onerror = (event) => {
      clearTimeout(timer)
      rej(
        new Error(`the debugging socket refused the connection: ${event?.message ?? 'no reason'}`),
      )
    }
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const waiting = message.id ? pending.get(message.id) : undefined
    if (waiting) {
      pending.delete(message.id)
      waiting.resolve(message)
    }
  }
  /*
    A DEAD SOCKET FAILS EVERY REQUEST WAITING ON IT.

    Without this a renderer that goes away mid-run leaves each in-flight promise
    unsettled, which is indistinguishable from a slow answer and lasts forever.
  */
  const abandon = (why) => {
    for (const waiting of pending.values()) waiting.reject(new Error(why))
    pending.clear()
  }
  ws.onclose = () => abandon('the debugging socket closed with a request in flight')
  ws.onerror = (event) => abandon(`the debugging socket errored: ${event?.message ?? 'no reason'}`)

  /*
    Every request can now FAIL, and that is the whole of this change.

    It was `new Promise((res) => ...)` — no reject path, no timeout, and no
    handler for the socket dying. So a reply that never came was not an error, it
    was a promise that stayed pending for the life of the process. Hit twice on
    2026-08-31: once as a silent exit 13 (Node ending on an unsettled top-level
    await, no output at all), and once as a four-minute stall entering the
    dark-theme half of the contrast check, which is where `setEmulatedMedia` got
    no answer.

    Rejecting names the method and fails that one check. It does NOT explain why
    a reply went missing — that cause is still unknown and not reproducible on
    demand — but it turns an anonymous hang into a line that says which call
    stopped answering, which is the difference between a gate that can be
    debugged and one that can only be re-run.
  */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1
      const key = id
      const timer = setTimeout(() => {
        pending.delete(key)
        reject(new Error(`${method} got no reply in ${CDP_TIMEOUT_MS / 1000}s`))
      }, CDP_TIMEOUT_MS)
      pending.set(key, {
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      ws.send(JSON.stringify({ id: key, method, params }))
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
    [
      '.',
      `--user-data-dir=${userData}`,
      `--remote-debugging-port=${PORT}`,
      /*
        Keep the window awake even when the desktop covers it.

        Chromium stops firing `requestAnimationFrame` and throttles timers for a
        window it considers occluded or backgrounded, and the gate runs on a
        real desktop where anything can end up on top of it. `settle` no longer
        HANGS when that happens — it races a timer — but a settle that falls
        back is a settle that waited 2s instead of 93ms, so these keep the fast
        path available rather than relying on the backstop.

        Flags rather than `backgroundThrottling: false` on the window: that
        would be a change to the product for a test's benefit, and the app has
        no reason to carry it.
      */
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
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
  // `userData` travels with the handle: the single-instance check needs the
  // profile this app holds the lock on, and reaching for a variable in `main`
  // from inside `checks` is how a check comes to test a different profile.
  return { app, userData, said: () => log }
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

/*
  CHECK, THEN SLEEP — both loops here did it the other way round.

  Each began `await wait(250)` and asked afterwards, so a process that died in
  20ms still cost a quarter of a second, twice over, and `stop` runs twice in a
  run. Measured: every check finished at 2.6s and the process did not exit until
  6.5s. Three and a nine-tenths seconds of a six-second gate was this function
  waiting to be allowed to notice something that had already happened.

  The budgets are unchanged — 5s for the exit, 10s for the port — because the
  counts are scaled by the same factor the interval shrank by. What changes is
  the granularity of noticing, from 250ms to 25.
*/
async function stop(running, { last = false } = {}) {
  endGroup(running.app)
  const gone = () => running.app.exitCode !== null || running.app.signalCode !== null
  // A graceful stop is worth waiting for between launches, because the app
  // writes its store on the way down and the next launch reads it. The last one
  // has no reader, so it does not get the grace.
  if (!last) for (let i = 0; i < 200 && !gone(); i += 1) await wait(25)
  if (!gone()) {
    try {
      process.kill(-running.app.pid, 'SIGKILL')
    } catch {
      running.app.kill('SIGKILL')
    }
  }
  /*
    Wait for the debugging port to go with it. Relaunching while the dying
    instance still holds it means the next attach lists the OLD window, which
    fails in a way that reads as a slow launch rather than as a stale port.

    ALWAYS, including the last one — tried and reverted.

    The obvious saving is to skip this at the end, since nothing in THIS run
    relaunches: it is 2.5s of a 6s gate. It hangs the next run. The port is a
    machine-wide resource and "nothing after it" is only true inside one
    invocation; the process that inherits the port is the next `pnpm rendered`,
    which then lists the dying window and waits for a target that will never
    match. The comment above was right and the scope it was written at was
    wider than one run.

    `last` survives so the SIGTERM can be skipped: the final teardown has
    nothing to flush, so it goes straight to a kill and the port comes back
    sooner.
  */
  for (let i = 0; i < 400; i += 1) {
    try {
      await listTargets()
    } catch {
      return
    }
    await wait(25)
  }
}

/** The shell is opened on demand, never at launch. Ask the companion for it. */
async function openShell() {
  const companion = await waitForTarget('companion')
  if (!companion) throw new Error('the companion window never appeared')
  const bridge = await attach(companion)
  /*
    WAIT FOR THE BRIDGE, do not assume it.

    A CDP target exists as soon as the page starts loading; `window.mochi` is
    put there by the preload, which lands later. Calling straight into it raced
    the renderer and crashed the whole run with "Cannot read properties of
    undefined (reading 'history')" — intermittently, which is the worst kind:
    the same commit passed twice and died on the third, and the failure looked
    like the gate rather than like a race.

    Polled rather than slept, for `until`'s own reason: a fixed wait answers
    "probably by now" and this answers "yes, and it took 34ms".
  */
  await until(
    bridge,
    'window.mochi && typeof window.mochi.history === "function"',
    'the companion to expose its bridge',
  )
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
      /*
        `speaker`, not `who` — the outer loop's `who` is the PERSONA and this one
        shadowed it.

        So `fts.run(text, rowid, who)` indexed every turn under `'you'` or
        `'her'` instead of under the character, and the search index this seed
        exists to populate was scoped to two persona ids that do not exist. The
        rows are there and no query for a real character can reach them, which
        is the shape of seed defect that makes a search check pass on an empty
        result.
      */
      for (const [speaker, text, cut] of talk.turns) {
        at += 5_000
        const row = turn.run(sessionId, at, speaker, text, cut)
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
    await goTo(page, place)
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
 * the two, a size that is not a rung of the scale, a radius that is not 8, 14,
 * 22 or round, a shadow anywhere but the top layer, a colour that is not a
 * token.
 *
 * It reports rather than fails, because a sweep is how you find out what to
 * check, and a list of forty deviations is not a gate.
 */

/**
 * The window's own structure, dumped the way the artboards were.
 *
 * `dev-docs/design-system-v2/extracted/` holds each screen's DOM read out of the
 * delivery — nesting, layout declarations, text. This writes the same shape for
 * what the app actually renders, into `rendered/`, so the two can be diffed.
 *
 * Written because the alternative was finding differences one CSS rule at a
 * time by eye, which is how a re-composition turns back into a re-tint: values
 * are easy to measure and structure is not, so structure is what stops being
 * checked. A `diff` of two files is a complete answer to "what is still
 * different", and it can be re-run after every change.
 *
 * The property list matches the artboard extractor's exactly. Any drift between
 * the two makes the diff lie in the most convincing possible way — a difference
 * that is really a difference in how the two sides were measured.
 */
async function outline(page) {
  const { writeFileSync, mkdirSync, readdirSync, rmSync } = await import('node:fs')
  const into = join(ROOT, 'dev-docs', 'design-system-v2', 'rendered')
  mkdirSync(into, { recursive: true })
  /*
    EMPTIED FIRST, so a run that dies partway leaves the screens it never
    reached ABSENT rather than stale.

    This dumper writes each file as it finishes a screen, and a run that stops
    early leaves the rest of the directory holding a previous run's output —
    same names, plausible contents, hours old. That is not a hypothetical: a
    dump from 12:14 was read as current at 14:40 and used to answer a question
    about what the window draws, and the answer was wrong.

    Absent is loud and stale is silent, so the failure mode is moved to the loud
    one. The stamp below is the second half: every file now says when it was
    taken and from which commit, so a file that survives some future partial run
    still cannot pass itself off as fresh.
  */
  for (const stale of readdirSync(into).filter((one) => one.endsWith('.txt'))) {
    rmSync(join(into, stale))
  }
  const taken = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
    .toString()
    .trim()
  console.log('\n  ─── the window, in the artboards\u2019 own terms ─────────────')
  /*
    EVERY SCREEN, not every TAB.

    The four views were dumped and the five screens underneath them were not, so
    the transcript — the largest surface in the application — and the three
    drill-downs off her page were the parts of this window nothing ever compared
    against a drawing. That is most of A2b, A2c, A3 and the whole of A8.

    `open` is a click that has to land before the dump; it is checked, because a
    selector that stops matching would leave this printing the page behind it
    under the name of the screen it failed to open — which is the same silent
    pass `goTo` throws about.
  */
  const SCREENS = [
    { place: 'cast', name: 'cast', open: null },
    { place: 'cast', name: 'expressions', open: '[data-opens="faces"]' },
    { place: 'cast', name: 'memory', open: '[data-opens="notes"]' },
    { place: 'cast', name: 'instruction', open: '[data-opens="instruction"]' },
    { place: 'archive', name: 'archive', open: null },
    { place: 'archive', name: 'transcript', open: '.list .entry' },
    { place: 'permits', name: 'permits', open: null },
    { place: 'machine', name: 'machine', open: null },
    /*
      ALL SEVEN GROUPS, not just the one the page opens on.

      B2 through B7 draw six screens — hearing, her prompts, on screen, keys,
      storage, about — and the dumper stopped at the first tab, so six of the
      window's fifteen screens had never been compared with anything. Picked by
      position because the nav is a list and the artboards number it that way;
      `machine-nav.ts` draws the numeral for the same reason.
    */
    { place: 'machine', name: 'hearing', open: '#nav-groups .tab:nth-of-type(2)' },
    { place: 'machine', name: 'prompts', open: '#nav-groups .tab:nth-of-type(3)' },
    { place: 'machine', name: 'on-screen', open: '#nav-groups .tab:nth-of-type(4)' },
    { place: 'machine', name: 'keys', open: '#nav-groups .tab:nth-of-type(5)' },
    { place: 'machine', name: 'storage', open: '#nav-groups .tab:nth-of-type(6)' },
    { place: 'machine', name: 'about', open: '#nav-groups .tab:nth-of-type(7)' },
  ]
  for (const screen of SCREENS) {
    const place = screen.name
    /*
      A HOP THROUGH ANOTHER VIEW FIRST, because a drill-down survives its own
      tab. `deeperInto` is cleared when the window LEAVES her page, so pressing
      "Who she is" while already standing on a sub-screen re-selects the tab and
      changes nothing — the second drill-down found no rows to press, because the
      first one was still open over them.
    */
    await goTo(page, screen.place === 'machine' ? 'cast' : 'machine')
    await wait(200)
    await goTo(page, screen.place)
    await wait(400)
    if (screen.open !== null) {
      const opened = await page.run(
        `(() => { const t = document.querySelector('${screen.open}');` +
          ` if (t === null) return false; t.click(); return true; })()`,
      )
      if (opened !== true) {
        throw new Error(
          `cannot open "${place}": no ${screen.open} on the ${screen.place} page. The dump ` +
            `would have been of whatever was already showing, under this screen's name.`,
        )
      }
      await wait(500)
    }
    const text = await page.run(`(() => {
      const KEEP = ['width','height','flex','display','flex-direction','padding','margin-top',
        'gap','background','border','border-radius','font-size','font-weight','font-family',
        'color','position','overflow','text-transform','letter-spacing','opacity'];
      const digest = (el) => {
        const s = getComputedStyle(el);
        const out = [];
        for (const prop of KEEP) {
          const v = s.getPropertyValue(prop);
          if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'static') {
            out.push(prop + ':' + v);
          }
        }
        return out.join('; ');
      };
      const lines = [];
      const walk = (el, depth) => {
        if (el.getClientRects().length === 0) return;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3 && n.textContent.trim())
          .map((n) => n.textContent.trim())
          .join(' ')
          .slice(0, 70);
        lines.push('  '.repeat(depth) + '<' + el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') +
          '>  ' + digest(el) + (own ? '   \u00ab ' + own + ' \u00bb' : ''));
        for (const kid of el.children) walk(kid, depth + 1);
      };
      const root = document.querySelector('.frame') ?? document.body;
      walk(root, 0);
      return lines.join(String.fromCharCode(10));
    })()`)
    const path = join(into, `${place}.txt`)
    writeFileSync(
      path,
      `# ${place} — what the window actually renders\n` +
        `# taken ${taken} UTC, at ${commit}\n\n${text}\n`,
    )
    console.log(
      `  ${place.padEnd(9)} ${String(text.split('\n').length).padStart(4)} nodes  -> ${path}`,
    )
  }
  console.log('  ─────────────────────────────────────────────────────────────\n')
}

async function audit(page) {
  /*
    The v2 system, and every value below was read OUT of the twenty artboards
    rather than transcribed from the handoff.

    That matters, because the handoff's own proposed list is wrong in both
    directions. It offers 34 and 26, which no artboard draws — 34 belongs to the
    shared masthead component and 26 to the design document's own headings — and
    it omits 11.5, 16, 17, 20 and 24, every one of which IS drawn. Shipped as
    written it would have reported five real sizes as deviations and quietly
    accepted two that are not in the product.

    The six one-off heading sizes (24, 22, 20, 19, 17, 16 — one use each) are
    listed here as the two rungs they were folded onto, matching `tokens.css`.
  */
  const SIZES = [34, 30, 22, 19, 15, 14.5, 14, 13.5, 13, 12.5, 12, 11, 10.5, 10]
  const FACES = ['Outfit', 'JetBrains Mono']
  const RADII = ['0px', '8px', '14px', '22px', '999px']
  /*
    The shadows this window is allowed, and why each one.

    "Hairlines, not shadows" was v1's rule, full stop. v2 NARROWS it rather than
    abandoning it: a shadow only on a surface in the TOP LAYER — something that
    floats above the page rather than sitting in it. Three surfaces qualify, and
    they are named individually here rather than exempted as a class.

    A blanket exemption was the obvious alternative and it is the wrong one. The
    whole value of this list is that the next unplanned shadow still reports; a
    rule saying "shadows are fine on floating things" makes every element that
    somebody decides is floating fine too.

    `span.light` stays for its own reason: the ring around a lit status light is
    what makes an 8px dot read as a light rather than as a bullet.
  */
  /*
    NAMED AS THE SWEEP NAMES THEM, which is tag + `#id` + `.` + FIRST CLASS.

    `div#month-pick` could never have matched: the element is
    `<div class="month-pick" id="month-pick">`, so the sweep calls it
    `div#month-pick.month-pick` and the entry silently exempted nothing. Harmless
    while that rule drew no shadow, and a finding somebody would have read as
    noise the day it did.

    `dialog#sure` and `div#troubles-drawer` match because those two happen to
    carry no class — which is luck rather than design, and is why this comment
    exists rather than three tidier names.

    `span.light` is GONE from this list, and that is the point of re-deriving an
    exemption rather than carrying it. It was inherited from v1's "the only
    permitted shadow", and by the time anybody looked it was exempting a
    different shadow on a different element for a different reason — a 3px glow
    around the readiness light, argued for in a stylesheet comment against a
    board that draws all seven states flat at 8px. The board won and the glow
    went, so the exemption has nothing left to exempt.
  */
  const ALLOWED = ['dialog#sure', 'div#troubles-drawer', 'div#month-pick.month-pick']

  /*
    Radii that are ARTWORK rather than a rung on the ladder.

    `tokens.css` states the distinction — "every one of those is INSIDE a mark:
    artwork, not a rung" — and the sweep has no way to see it, so it reported the
    same three deviations on every run of every screen. A report whose top is
    always identical is a report nobody reads, which is how the last one got to
    forty entries.

    Both are drawn shapes standing in for a picture: the rail's machine tile at 9
    and the machine masthead's mark at 18, each with a smaller square inside it.
    Named, so adding a fourth is a decision somebody makes here.
  */
  const RADIUS_IS_ARTWORK = ['span.rail-tile', 'span.machine-mark']

  console.log('\n  ─── the sweep ───────────────────────────────────────────────')
  for (const theme of ['light', 'dark']) {
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }],
    })
    for (const place of ['cast', 'archive', 'permits', 'machine']) {
      await goTo(page, place)
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
      for (const v of oddRadius) {
        // Every element carrying it has to be artwork, not merely one of them —
        // the same all-or-nothing the shadow list below uses, so a new element
        // borrowing an artwork radius still shows up.
        if (found.radii[v].every((one) => RADIUS_IS_ARTWORK.includes(one))) continue
        lines.push(`radius  ${v}  ${found.radii[v].join(' ')}`)
      }
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
    await goTo(page, place)
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
    await goTo(page, place)
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
    await goTo(page, place)
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
  /*
    AND THE PANEL, which is a surface rather than a place.

    It rises over whichever page is up, so it belongs to none of the four above
    and would be photographed by none of them. Shown with something typed: an
    empty one is a box and a line of prose, and what wants looking at is a list
    of results -- whether the group beside each label reads as apparatus or as
    clutter, and whether the current row is legible at a glance.
  */
  await goTo(page, 'cast')
  await page.run(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    const q = document.getElementById('jump-q');
    q.value = 'her';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  /*
    THE PANEL IS THERE BEFORE THE SHUTTER, checked rather than waited out.

    This slept and shot whatever was on screen, so a key that stopped opening the
    panel produced an ordinary page screenshot under the panel's filename -- a
    photograph of the feature being broken, filed as a photograph of the feature.
    `until` throws when the condition never arrives, which is what makes the file
    mean what its name says.
  */
  await until(
    page,
    `document.getElementById('jump').open && document.querySelectorAll('#jump-found .jump-row').length > 0`,
    'the find-a-setting panel to open with results',
  )
  await settle(page)
  const panel = await page.send('Page.captureScreenshot', { format: 'png' })
  const drawn = panel.result?.data
  if (drawn) {
    writeFileSync(join(into, 'find-a-setting.png'), Buffer.from(drawn, 'base64'))
    console.log('  shot  dev-docs/shots/find-a-setting.png  showing: find a setting')
  }
  await page.run(`document.getElementById('jump').close()`)
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
  await goTo(page, 'archive')

  await step('A1', async () => {
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
  })

  await step('A2', async () => {
    /* --- A2: picking a day filters, it does not scroll --------------------- */
    const filtered = await page.run(`(() => {
    const list = document.querySelector('#list');
    const before = { rows: list.querySelectorAll('.entry').length, top: list.scrollTop };
    const days = [...document.querySelectorAll('button.day.has')];
    const other = days.find((d) => d.getAttribute('aria-current') !== 'true');
    if (!other) return { why: 'every day with conversations was already the current one' };
    other.click();
    return { before, other: other.textContent.trim() };
  })()`)
    await settle(page)
    const afterPick = await page.run(`(() => {
    const list = document.querySelector('#list');
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
  })

  await step('closed', async () => {
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
  })

  await step('anchored', async () => {
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
    await settle(page)
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
  })

  await step('one-row', async () => {
    /* --- the month and the days are one row -------------------------------- */
    /*
      CENTRES, not tops, and the two CONTROLS rather than one control and a
      child of the other.

      It compared the top of the month label with the top of a day numeral,
      which was a fair proxy while both were bare text on one baseline. They are
      not: the month is a 78px slot with its own padding and a day is a 25px disc
      with the numeral centred inside it, so their tops differ by construction
      and the check failed on a layout that is correct. Two boxes of different
      heights sit on one row when their centres agree — which is what the words
      "one row" meant all along, and a month genuinely floated above the days
      still fails it.
    */
    const oneRow = await page.run(`(() => {
    const month = document.querySelector('.daystrip .month');
    const day = document.querySelector('.strip .day');
    if (!month || !day) return { why: 'the day strip has no month or no days' };
    const mid = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2) };
    return { month: mid(month), numeral: mid(day) };
  })()`)
    if (oneRow.why) bad('one-row', oneRow.why)
    else if (Math.abs(oneRow.month - oneRow.numeral) > 4)
      bad(
        'one-row',
        'the month and the days are on different lines, centre to centre: ' +
          oneRow.month +
          ' against ' +
          oneRow.numeral +
          ' — something is padding one of them',
      )
    else ok('one-row', 'the month sits on the same line as the days it names')
  })

  await step('strip-holds', async () => {
    /* --- paging a month does not move the days ----------------------------- */
    /*
      The month's name sits in a fixed slot, so the thirty-one day cells stay
      where they are while it changes.

      It was shrink-to-fit at 12px. "May 2026" and "September 2026" are
      different widths, so paging slid the forward arrow and every day cell
      sideways — under the pointer that had just pressed the arrow, which is the
      one moment a control must not move. A6 gives the slot `width: 78px` and
      that width is the whole point of it.

      Measured across a month whose name is SHORT and one whose name is LONG,
      because two months of similar width would agree by luck.
    */
    /*
      IT PUTS THE MONTH BACK, and that is not tidiness.

      This is the only check that navigates the archive in TIME, and it left the
      strip five months forward — so `A1-months`, which compares the picker
      against the strip's own dots, ran against a September with nothing in it
      and reported the picker as lying.

      Caught by the full run and not by `--only strip-holds`, which passed
      because it ran alone. A filtered run reads one check's verdict honestly; it
      cannot tell you that the check dirties the window for the next one. Every
      check establishing its own page is what makes a subset MEAN the same thing;
      it is not what makes a check safe to run before another one.

      RE-QUERIED every pass, not held across one.

      The first version of this captured the strip and the forward arrow once
      and clicked the same node five times. Paging rebuilds the whole row, so
      both references were detached after the first click: the month stopped
      advancing and the strip's rect read 0. A stale node is not an error — it
      is an element that answers, from outside the document.
    */
    const held = await page.run(`(() => {
      const seen = [];
      for (let i = 0; i < 5; i += 1) {
        const strip = document.querySelector('.daystrip .strip');
        const label = document.querySelector('.daystrip .month');
        const on = [...document.querySelectorAll('.daystrip .step')].pop();
        if (!strip || !label || !on) return { why: 'the day strip has no month navigation' };
        seen.push({
          month: (label.textContent || '').trim(),
          left: Math.round(strip.getBoundingClientRect().left),
        });
        on.click();
      }
      // Put the strip back where it was found. See the note above this block.
      for (let i = 0; i < 5; i += 1) {
        const back = document.querySelector('.daystrip .step');
        if (back) back.click();
      }
      const names = seen.map((o) => o.month);
      const lefts = [...new Set(seen.map((o) => o.left))];
      return { names, lefts, widest: Math.max(...names.map((n) => n.length)),
               narrowest: Math.min(...names.map((n) => n.length)) };
    })()`)
    if (held.why) bad('strip-holds', held.why)
    else if (held.widest === held.narrowest)
      bad(
        'strip-holds',
        `every month name was ${held.widest} characters, so nothing was tested: ${JSON.stringify(held.names)}`,
      )
    else if (held.lefts.length > 1)
      bad(
        'strip-holds',
        `the days move when the month does: ${JSON.stringify(held.names)} start at ${JSON.stringify(held.lefts)}`,
      )
    else ok('strip-holds', `the days hold still across ${JSON.stringify(held.names)}`)
  })

  await step('focus-hugs', async () => {
    /* --- a focused field's ring sits on the field ------------------------- */
    /*
      Two things, measured on the computed style rather than argued from the
      rule, because both were introduced by rules that read correctly.

      ONE RING. The sandwich's innermost layer is an ink edge at the control's
      own boundary, which is what makes a bare button findable — a button has no
      edge of its own. A field is a filled well with `border: 0`, so that layer
      draws the well's outline twice with a hairline of paper trapped between.

      AND NO OFFSET. The 3px gap is what separates the sandwich's inner edge from
      its outer ring; with the inner edge gone it is a band of page between the
      fill and the ring around it, and a ring that does not touch what it is
      around reads as a second object beside it.

      Every field, not one: the fields on her page, the machine's, and the search
      pill are three different rules and the defect was in all of them.
    */
    const rings = []
    for (const place of ['cast', 'archive', 'machine']) {
      await goTo(page, place)
      /*
        EVERY GROUP on the machine's page, and not whichever one the run before
        this happened to leave open.

        `goTo` reaches the page; it does not choose the group, and the group is
        held in a module-level `openGroup` that survives leaving the page. So
        this measured Looking in a plain run and About after `--outline` had
        walked all seven — five fields or eight, from the same code, with the
        count silently reporting which. Neither number was wrong and neither was
        the one this check claims to take.

        Walking them is the fix rather than pinning one, because the comment
        above says every field: the machine's fields are spread across seven
        groups and six of them were never in the set.
      */
      const groups =
        place === 'machine'
          ? await page.run(`document.querySelectorAll('#nav-groups .tab').length`)
          : 1
      if (groups === 0) throw new Error('the machine page has no groups to walk')
      for (let group = 0; group < groups; group += 1) {
        if (place === 'machine') {
          await page.run(
            `(() => { const t = document.querySelectorAll('#nav-groups .tab')[${String(group)}];` +
              ` if (t) t.click(); return true })()`,
          )
          await settle(page)
        }
        const found = await page.run(`(() => {
        const out = [];
        for (const f of document.querySelectorAll('input[type=text], input[type=search], select, textarea')) {
          if (f.getClientRects().length === 0 || f.disabled) continue;
          f.focus();
          const own = getComputedStyle(f);
          const box = f.closest('.finding');
          const s = box === null ? own : getComputedStyle(box);
          out.push({
            id: f.id || f.className || f.tagName.toLowerCase(),
            offset: parseFloat(s.outlineOffset) || 0,
            width: parseFloat(s.outlineWidth) || 0,
            layered: s.boxShadow !== 'none',
          });
          f.blur();
        }
        return out;
      })()`)
        rings.push(...found)
      }
    }
    const gapped = rings.filter((one) => one.offset !== 0)
    const layered = rings.filter((one) => one.layered)
    const ringless = rings.filter((one) => one.width === 0)
    if (rings.length < 4)
      bad(
        'focus-hugs',
        `only ${String(rings.length)} fields were reachable, so little was compared`,
      )
    else if (ringless.length > 0)
      bad('focus-hugs', 'a field shows no ring at all: ' + JSON.stringify(ringless))
    else if (layered.length > 0)
      bad(
        'focus-hugs',
        'a field draws its own edge as well as the ring: ' + JSON.stringify(layered),
      )
    else if (gapped.length > 0)
      bad('focus-hugs', 'a ring stands off its field: ' + JSON.stringify(gapped))
    else ok('focus-hugs', `all ${String(rings.length)} fields ring their own edge, once`)
  })

  await step('no-scrollbars', async () => {
    /* --- no container draws a scrollbar ------------------------------------ */
    /*
      Asserted on the computed `scrollbar-width`, and the first version of this
      check was not — it measured `offsetWidth - clientWidth`, on the reasoning
      that a classic bar takes fifteen pixels out of the content box. It passed
      identically with the rule in and with the rule removed, which is how the
      reasoning turned out to be wrong: macOS draws OVERLAY scrollbars, so they
      never took any width and there was nothing for that measurement to see.

      The honest reason for hiding them is the one the delivery gives rather than
      one about arithmetic: no artboard draws a scrollbar, and the bubble
      document says why in general — "滚动条是'在气泡里读完一段'的家具", furniture for
      reading a passage through — replacing it with a fade, while B3 answers the
      same question with "24 more below". That is a decision about appearance,
      and a check on appearance is what can hold it.

      Measured on containers that OVERFLOW, so it is asserting about bars that
      would otherwise be drawn rather than about ones that never appear.
    */
    await goTo(page, 'machine')
    await page.run(
      `(() => { const t = document.querySelectorAll('#nav-groups .tab')[2]; if (t) t.click(); return true })()`,
    )
    await settle(page)
    const bars = await page.run(`(() => {
      const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0]);
      const out = { overflowing: [], showing: [] };
      for (const e of document.querySelectorAll('*')) {
        const cs = getComputedStyle(e);
        if (!/auto|scroll/.test(cs.overflowY + cs.overflowX)) continue;
        if (e.scrollHeight <= e.clientHeight) continue;
        out.overflowing.push(name(e));
        if (cs.scrollbarWidth !== 'none') out.showing.push(name(e) + ' is ' + cs.scrollbarWidth);
      }
      return out;
    })()`)
    if (bars.overflowing.length === 0)
      bad('no-scrollbars', 'nothing on that page overflows, so no scrollbar could have been drawn')
    else if (bars.showing.length > 0)
      bad('no-scrollbars', 'a container still draws one: ' + JSON.stringify(bars.showing))
    else
      ok(
        'no-scrollbars',
        `${String(bars.overflowing.length)} container(s) overflow and none draws a bar`,
      )
  })

  await step('one-of-her', async () => {
    /* --- a second launch refuses, and refuses BEFORE it does anything ------ */
    /*
      Several claims in this repository rest on there being one process, not on
      any code: `preferences.json` says its writes are read-change-write with no
      lock, `usage.json` follows it, and `transcripts.ts` states flatly that
      "this one is the only writer". None of that is enforced anywhere. It is
      true because a second instance stops.

      It very nearly was not. `app.quit()` is asynchronous — it schedules the
      end and lets the module go on being evaluated — so a losing instance was
      observed printing "another mochi is already running" and then
      `[capability] 3 available`, from a process that had supposedly refused to
      start. How much further it got was a race with `whenReady`.

      So this asserts the refusal AND the silence after it. The second line is
      the one that matters: a loser that keeps evaluating is a loser that can
      reach a store.
    */
    const second = spawnSync(electronBinary(), ['.', `--user-data-dir=${running.userData}`], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 30_000,
    })
    const said = `${second.stdout ?? ''}${second.stderr ?? ''}`
    const refused = said.includes('already running')
    // A line only a STARTING instance prints. If this appears, the module went
    // on past the lock.
    const carriedOn = said.includes('[capability]')
    if (second.status !== 0) {
      bad('one-of-her', `a second launch exited ${String(second.status)} rather than standing down`)
    } else if (!refused) {
      bad(
        'one-of-her',
        `a second launch did not recognise the first: ${JSON.stringify(said.slice(-200))}`,
      )
    } else if (carriedOn) {
      bad('one-of-her', 'the second launch refused and then carried on starting anyway')
    } else {
      ok('one-of-her', 'a second launch stands down, and stops there')
    }
  })

  await step('about-links', async () => {
    /* --- pressing an address asks main to open THAT address ---------------- */
    /*
      What cannot be established by reading the pane: that each row is wired to
      its own link. Three buttons calling the same handler with the same
      argument would look identical in the source and be identical on screen,
      and the fault would only show as "Website opens the repository".

      Read off `data-opens` rather than pressed. Pressing for real opens three
      browser tabs on whoever runs the gate, and patching `openLink` to observe
      instead does not work: `contextBridge` freezes what it exposes, so the
      assignment fails SILENTLY and the real handler runs anyway. That was tried
      here, and it opened the tabs it was written to avoid.

      The attribute is the same value the click handler closes over, so this
      asserts the behaviour rather than a label beside it.
    */
    await goTo(page, 'machine')
    await page.run(
      `(() => { const t = document.querySelectorAll('#nav-groups .tab')[6]; if (t) t.click(); return true })()`,
    )
    await settle(page)
    const rows = `[...document.querySelectorAll('#machine-pane .about-link')]`
    const shape = await page.run(`(() => {
      return ${rows}.map((r) => ({
        tag: r.tagName.toLowerCase(),
        what: (r.querySelector('.about-what') || {}).textContent || '',
        said: (r.querySelector('.about-said') || {}).textContent || '',
        glyphs: r.querySelectorAll('svg').length,
      }));
    })()`)
    const want = ['Author', 'Source', 'Website', 'Version']
    if (shape.map((r) => r.what).join(',') !== want.join(',')) {
      bad(
        'about-links',
        `expected ${want.join(', ')}, saw ${JSON.stringify(shape.map((r) => r.what))}`,
      )
      return
    }
    /*
      STYLED, not merely present.

      A span-replacement in the stylesheet once deleted every `.about-*` rule
      and this gate still reported all green: the rows existed, carried their
      words and their glyphs, and were drawn as four unstyled lines. Structure
      was checked and appearance was not, so the check passed over the page it
      was written for being broken.

      The label column is the tell. 88px is what makes three addresses share a
      left edge, and it exists only if the rules are there.
    */
    const laid = await page.run(`(() => {
      const row = document.querySelector('#machine-pane .about-link');
      const what = document.querySelector('#machine-pane .about-what');
      if (row === null || what === null) return null;
      return {
        display: getComputedStyle(row).display,
        label: Math.round(what.getBoundingClientRect().width),
      };
    })()`)
    if (laid === null || laid.display !== 'flex' || laid.label !== 88) {
      bad('about-links', `the rows are not styled: ${JSON.stringify(laid)}`)
      return
    }
    if (shape.some((r) => r.glyphs !== 1)) {
      bad('about-links', `every row needs exactly one glyph: ${JSON.stringify(shape)}`)
      return
    }
    if (shape[3].tag !== 'div') {
      bad('about-links', 'the version row is pressable, and it goes nowhere')
      return
    }
    const opens = await page.run(
      `${rows}.filter((r) => r.tagName.toLowerCase() === 'button').map((r) => r.dataset.opens)`,
    )
    if (opens.join(',') !== 'author,repo,site') {
      bad('about-links', `each row must open its own address; got ${JSON.stringify(opens)}`)
    } else {
      ok('about-links', `${String(shape.length)} rows, and author/repo/site each open their own`)
    }
  })

  await step('voices', async () => {
    /* --- pressing a voice actually plays that voice ------------------------ */
    /*
      THE WIRING, NOT THE SOUND. Whether cedar sounds like cedar is not a thing
      a runner can hear. What it can establish is everything between the press
      and the audio element: that the pills are there, that a press reaches the
      listener, that the listener resolved a URL for the voice that was pressed
      rather than for some other one, and that the URL is a real asset in the
      build rather than a 404 nobody would notice — because a clip that fails to
      load is silence, and silence is exactly what this control looked like
      before it had any clips at all.

      `Audio` is patched before the press so the constructed src can be read
      back. It is put back afterwards; the window stays usable for later checks.
    */
    await goTo(page, 'cast')
    await settle(page)
    const pills = `[...document.querySelectorAll('.pills button')]`
    const found = await page.run(`(() => {
      window.__clips = [];
      window.__realAudio = window.Audio;
      window.Audio = function (src) { window.__clips.push(src); return new window.__realAudio(); };
      const names = ${pills}.map((b) => (b.textContent || '').trim());
      return { names };
    })()`)
    const wanted = ['cedar', 'marin', 'coral']
    const present = wanted.filter((one) => found.names.includes(one))
    if (present.length !== wanted.length) {
      bad(
        'voices',
        `expected ${JSON.stringify(wanted)} among the pills, saw ${JSON.stringify(found.names)}`,
      )
      return
    }
    for (const voice of wanted) {
      await page.run(
        `(() => { const b = ${pills}.find((x) => (x.textContent || '').trim() === '${voice}');` +
          ` if (b) b.click(); return true })()`,
      )
      await settle(page)
    }
    const heard = await page.run(`(async () => {
      const clips = window.__clips.slice();
      const checked = [];
      for (const src of clips) {
        try {
          const res = await fetch(src);
          checked.push({ src, ok: res.ok, type: res.headers.get('content-type') || '' });
        } catch (e) { checked.push({ src, ok: false, type: String(e) }); }
      }
      window.Audio = window.__realAudio;
      return checked;
    })()`)
    const named = wanted.map((one) => heard.some((c) => String(c.src).includes(one)))
    if (heard.length < wanted.length) {
      bad(
        'voices',
        `pressed ${String(wanted.length)} voices, ${String(heard.length)} clips were requested`,
      )
    } else if (named.includes(false)) {
      bad(
        'voices',
        `a press asked for a clip that is not that voice: ${JSON.stringify(heard.map((c) => c.src))}`,
      )
    } else if (heard.some((c) => !c.ok)) {
      bad('voices', `a clip did not load: ${JSON.stringify(heard.filter((c) => !c.ok))}`)
    } else {
      ok(
        'voices',
        `${String(found.names.length)} on offer; pressing ${wanted.join(', ')} fetched each one's own clip`,
      )
    }
  })

  await step('languages', async () => {
    /* --- many at once, and the ceiling holds where it is drawn ------------- */
    /*
      THE CONTROL WHOSE DEFECT CANNOT BE FOUND BY READING IT.

      `Hearing you` was a `select` in `multiple`, and what was wrong with it was
      in no rule and no string: a plain click in a list box deselects every
      other option, and that pane saves on `change`. So somebody holding three
      languages who clicked a fourth without the modifier key was left with one,
      and the status bar said "Saved." Nothing in the source says that. It is a
      fact about what the element DOES, which is the only kind of fact this file
      is here to hold.

      So the check is the gesture rather than the markup: press seven and there
      must be six, with the seventh refused out loud, the chosen ones drawn
      differently from the rest, and the sentence about the limit arriving only
      once the limit is reached.

      It puts the pane back before it returns. A check that left six languages
      chosen would be a check that changed what every check after it measured,
      which is the same silent lie `goTo` throws about.
    */
    await goTo(page, 'machine')
    await page.run(
      `(() => { const t = document.querySelectorAll('#nav-groups .tab')[1]; if (t) t.click(); return true })()`,
    )
    await settle(page)
    const pills = `document.querySelectorAll('#machine-pane .pills button[aria-pressed]')`
    const chosenNow = `[...${pills}].filter((b) => b.getAttribute('aria-pressed') === 'true').length`
    const limitNote = `[...document.querySelectorAll('#machine-pane p.note')].some((p) => p.textContent.includes('is the limit'))`
    const shape = await page.run(`(() => {
      const group = document.querySelector('#machine-pane .pills');
      return {
        named: group === null ? null : group.getAttribute('role') + ' ' + String(group.getAttribute('aria-label')),
        pills: ${pills}.length,
        selects: document.querySelectorAll('#machine-pane select').length,
        limit: ${limitNote},
      };
    })()`)
    if (shape.named === null || shape.pills === 0) {
      bad('languages', 'the hearing pane draws no group of pressable languages')
      return
    }
    if (shape.selects > 0) {
      bad(
        'languages',
        'a <select> is back on the hearing pane — one plain click in a list box clears every other choice, and this pane saves on change',
      )
      return
    }
    if (shape.limit) {
      bad('languages', 'the sentence about the limit is drawn with nothing chosen')
      return
    }
    const press = async (which, want) => {
      await page.run(
        `(() => { const b = ${pills}[${String(which)}]; if (b) b.click(); return true })()`,
      )
      await until(
        page,
        `${chosenNow} === ${String(want)}`,
        `the pane to settle at ${String(want)} chosen`,
      )
    }
    for (let which = 0; which < 6; which += 1) await press(which, which + 1)
    // The seventh is refused, so nothing is saved and nothing redraws — there is
    // no condition to wait for, only a frame to let the message land in.
    await page.run(`(() => { const b = ${pills}[6]; if (b) b.click(); return true })()`)
    await settle(page)
    const after = await page.run(`(() => {
      const all = [...${pills}];
      const on = all.filter((b) => b.getAttribute('aria-pressed') === 'true');
      const off = all.filter((b) => b.getAttribute('aria-pressed') !== 'true');
      const drawn = (b) => { const s = getComputedStyle(b); return s.backgroundColor + ' on ' + s.color; };
      return {
        chosen: on.map((b) => b.textContent.trim()),
        marked: on.length === 0 ? '' : drawn(on[0]),
        plain: off.length === 0 ? '' : drawn(off[0]),
        hint: (document.querySelector('#machine-pane .hint') || {}).textContent || '',
        limit: ${limitNote},
        said: (document.getElementById('status') || {}).textContent || '',
      };
    })()`)
    const why =
      after.chosen.length !== 6
        ? `pressing seven left ${String(after.chosen.length)} chosen: ${JSON.stringify(after.chosen)}`
        : after.marked === after.plain
          ? `a chosen language is drawn exactly like an unchosen one (${after.marked})`
          : !after.said.includes('at most')
            ? `the seventh was refused without saying so: ${JSON.stringify(after.said.trim())}`
            : !after.hint.includes('6 chosen')
              ? `the count beside the heading does not say what it counts: ${JSON.stringify(after.hint)}`
              : !after.limit
                ? 'nothing on the pane says what to do now that the limit is reached'
                : null
    if (why !== null) {
      bad('languages', why)
      return
    }
    for (let which = 5; which >= 0; which -= 1) await press(which, which)
    const back = await page.run(`({ chosen: ${chosenNow}, limit: ${limitNote} })`)
    if (back.chosen !== 0 || back.limit) {
      bad('languages', 'a language could not be given back: ' + JSON.stringify(back))
      return
    }
    ok(
      'languages',
      `${String(shape.pills)} on screen, ${String(after.chosen.length)} taken and the seventh refused, each one given back`,
    )
  })

  await step('field-widths', async () => {
    /* --- one width for every single-line field ----------------------------- */
    /*
      Three fields in one column came out 420, 548 and 666, and the reason was
      which of them happened to share a row: `.setting > input` carried
      `max-width: none` at (0,2,1), which beat V7's 420 cap at (0,1,1) and
      reached only the DIRECT children — so her name, nested a level deeper
      inside `.setting-pair`, took the cap while the two beside it did not.

      A1 does draw them at different widths, because each row has different
      siblings. That is what `flex: 1` gives you and it is not what a column of
      fields should look like: the right-hand edge is what a reader lines up on,
      and three fields ending in three places read as three unrelated controls.

      Measured on the WIDTHS rather than on the rule, because the defect was one
      selector out-specifying another and both were present and correct-looking.
    */
    await goTo(page, 'cast')
    const fields = await page.run(`(() => {
      const seen = [...document.querySelectorAll('#pane input[type=text], #pane select')]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => ({ id: e.id || e.className, w: Math.round(e.getBoundingClientRect().width) }));
      return { seen, widths: [...new Set(seen.map((o) => o.w))] };
    })()`)
    if (fields.seen.length < 3)
      bad(
        'field-widths',
        `only ${String(fields.seen.length)} fields on her page, so nothing was compared`,
      )
    else if (fields.widths.length > 1)
      bad('field-widths', 'her single-line fields are ' + JSON.stringify(fields.seen))
    else
      ok(
        'field-widths',
        `all ${String(fields.seen.length)} single-line fields on her page are ${String(fields.widths[0])} wide`,
      )
  })

  await step('A1-months', async () => {
    /* --- a month with nothing in it is not a button either ----------------- */
    /*
      A1 one level up. The day strip refuses to make an empty day pressable and
      this file checks it; the month picker made all twelve live, so it offered
      eleven ways to arrive at an empty column — the same "anything offering a
      period with nothing in it must not appear actionable" the day check exists
      for, unenforced where nobody had looked.

      Measured against the STRIP, not against a count typed in here: the days
      with dots are the months that have something, so the two surfaces have to
      agree about the same archive or one of them is lying.
    */
    const months = await page.run(`(() => {
      const open = document.querySelector('.daystrip .month');
      if (!open) return { why: 'the day strip has no month control' };
      open.click();
      const all = [...document.querySelectorAll('.month-one')];
      if (all.length !== 12) return { why: 'the picker offers ' + all.length + ' months, not 12' };
      const live = all.filter((b) => !b.disabled).map((b) => b.textContent.trim());
      const dotted = document.querySelectorAll('.daystrip .day .dot').length;
      const open_ = document.querySelector('.month-pick');
      if (open_ && open_.hidePopover) open_.hidePopover();
      return { live, dotted, note: (document.querySelector('.month-note') || {}).textContent };
    })()`)
    if (months.why) bad('A1-months', months.why)
    else if (months.dotted > 0 && months.live.length === 0)
      bad('A1-months', 'the strip shows days with something on them and the picker offers no month')
    else if (months.dotted === 0 && months.live.length > 0)
      bad(
        'A1-months',
        `the strip is empty and the picker still offers ${JSON.stringify(months.live)}`,
      )
    else if (months.live.length === 12)
      bad('A1-months', 'every month is pressable, so eleven of them open an empty column')
    else if (!months.note)
      bad(
        'A1-months',
        `${months.live.length} of 12 months are live and nothing says why the rest are not`,
      )
    else
      ok(
        'A1-months',
        `only the months with something in them are pressable (${JSON.stringify(months.live)}), and it says so`,
      )
  })

  await step('month', async () => {
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
    await settle(page)
    if (picker.why) bad('month', picker.why)
    else if (picker.months !== 12)
      bad('month', 'the picker offers ' + picker.months + ' months, not 12')
    else if (picker.refused !== picker.was)
      bad('month', 'a year the archive cannot hold moved the strip anyway: ' + picker.refused)
    else if (!/2024/.test(picker.moved))
      bad('month', 'typing a year did not move the strip: ' + picker.moved)
    else if (picker.stillOpen)
      bad('month', 'the picker stayed open over the strip it had just moved')
    else ok('month', 'opens, refuses "20", moves to ' + picker.moved + ', and closes behind itself')

    /*
    Escape, which is the platform's and has to actually reach it.

    A popover gets this for free and that is the reason for using one — but
    "for free" is a claim about a mechanism, and the mechanism is only in force
    if the element really is a popover and really is open. Both have been true
    and neither was, in this window, an hour ago.
  */
    await page.run(`document.querySelector('.daystrip .month').click()`)
    await settle(page)
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {
        type,
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      })
    }
    await settle(page)
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
    await settle(page)
  })

  await step('D2', 'D3', async () => {
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
      rowsBefore: document.querySelectorAll('#list .entry').length,
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
        bad(
          'D3',
          'the dialog offers no way to save a copy first: ' + JSON.stringify(opened.buttons),
        )
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
      await settle(page)
      const after = await page.run(`({ open: document.querySelectorAll('dialog[open]').length,
                                     rows: document.querySelectorAll('#list .entry').length })`)
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
  })

  await step('D4', async () => {
    /* --- D4: no single conversation is deletable in one gesture ------------ */
    const perRow = await page.run(`(() => {
    const rows = [...document.querySelectorAll('#list .entry')];
    const armed = rows.filter((r) => [...r.querySelectorAll('button, [role=button]')]
      .some((c) => /delete|forget|remove|✕|×/i.test(c.textContent + (c.getAttribute('aria-label') || ''))));
    return { rows: rows.length, armed: armed.length };
  })()`)
    if (perRow.rows === 0) bad('D4', 'no conversation rows were drawn, so this proves nothing')
    else if (perRow.armed > 0) bad('D4', perRow.armed + ' conversation rows carry their own delete')
    else ok('D4', 'no single conversation can be deleted in one gesture (' + perRow.rows + ' rows)')
  })

  await step('A6', async () => {
    /* --- A6: copying takes the original text, not what is on screen ------- */
    const copied = await page.run(`(() => {
    const entry = document.querySelector('#list .entry');
    if (!entry) return { why: 'no conversation to open' };
    entry.click();
    return { opened: true };
  })()`)
    await settle(page)
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
      await settle(page)
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
  })

  await step('rail', async () => {
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
  })

  await step('C4', async () => {
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
      bad(
        'C4',
        'the character with no face file is drawn with an identical picture to the built-in',
      )
    else
      ok(
        'C4',
        'a missing face is not silently substituted (' +
          JSON.stringify(faces.shots.map((s) => s.name)) +
          ')',
      )
  })

  await step('editable', 'C5', async () => {
    /* --- an editable thing looks editable --------------------------------- */
    /*
    ON HER PAGE, and it says so rather than measuring whatever was showing.

    This ran on whichever page the check before it happened to leave up, and the
    check before it navigates. So it raced: three runs of an unchanged build
    reported "all 1 editable things say so at rest", then "no editable control
    was drawn, so this proves nothing", then 1 again — and the failing run was
    not a defect in the window, it was this check arriving a beat early.

    ONE was the tell even when it passed. Her page carries two text fields and
    three choosers; a run that finds a single control is a run that landed on
    the archive and measured its search box. A check that can silently sample
    one subject instead of five is one whose green means very little.
  */
    await goTo(page, 'cast')
    await settle(page)
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
    if (editable.seen === 0)
      bad('editable', 'no editable control was drawn, so this proves nothing')
    else if (editable.silent.length > 0)
      bad(
        'editable',
        editable.silent.length +
          ' editable things show no rule, box or fill: ' +
          JSON.stringify(editable.silent),
      )
    else ok('editable', 'all ' + editable.seen + ' editable things say so at rest')

    /*
    C5 · SEEING A FACE AND PERMITTING IT ARE TWO ACTIONS.

    This check was removed when the mood tiles were, and the note left in its
    place said: "If a control ever offers looking-at and permitting side by side
    again, this is the check it needs." A2c is that control.

    Two things are asserted, and they fail in opposite directions:

    - Every tile draws its face WHATEVER the switch says. A gallery that hid
      withheld expressions would collapse the two questions into one control, and
      "you can always look" is the rule.
    - The face is not INSIDE the switch's label. Wrapping a tile in a `<label>`
      whose `<input>` lives in it is invalid HTML, and it makes looking at a face
      a click that permits it.
  */
    /*
    HER EXPRESSIONS IS A SCREEN, not a section, so this has to open it.

    A2c has its own title and its own apparatus column in the delivery, which
    makes it a drill-down from view I rather than a block in her sheet. The check
    found no tiles and said so — which is the right failure, and the reason it is
    a `bad()` rather than a skip: "no tiles" and "tiles that are wrong" must not
    look the same from here.
  */
    await page.run(
      `(() => { const row = document.querySelector('[data-opens="faces"]'); if (row) row.click(); })()`,
    )
    await settle(page)
    const tiles = await page.run(`(() => {
    const all = [...document.querySelectorAll('.face-tile')];
    return {
      count: all.length,
      drawn: all.filter((t) => t.querySelector('canvas') !== null).length,
      switched: all.filter((t) => t.querySelector('input[type=checkbox]') !== null).length,
      withheld: all.filter((t) => t.querySelector('input[type=checkbox]')?.checked === false).length,
      wrapped: all.filter((t) => t.querySelector('label canvas') !== null).length,
    };
  })()`)
    if (tiles.count === 0) bad('C5', 'no expression tiles on her page, so nothing was measured')
    else if (tiles.drawn !== tiles.count)
      bad('C5', `${String(tiles.count - tiles.drawn)} of ${String(tiles.count)} tiles draw no face`)
    else if (tiles.switched !== tiles.count)
      bad(
        'C5',
        `${String(tiles.count - tiles.switched)} of ${String(tiles.count)} tiles have no switch`,
      )
    else if (tiles.wrapped > 0)
      bad('C5', `${String(tiles.wrapped)} tiles put the face inside the switch's own label`)
    else
      /*
      The withheld half is only PROVED when something is withheld.

      The seeded profile permits all eight, so `drawn === count` holds whether or
      not a withheld tile would be hidden — the interesting case is not on
      screen. Said out loud rather than reported as a pass, which is the same
      honesty the day-counting checks on the machine's page already practise.
    */
      ok(
        'C5',
        tiles.withheld > 0
          ? `all ${String(tiles.count)} faces drawn and separately switched, ` +
              `including ${String(tiles.withheld)} withheld`
          : `all ${String(tiles.count)} faces drawn and separately switched — none is ` +
              'withheld in this profile, so "withheld faces are still drawn" is untested here',
      )
  })

  await step('contrast', async () => {
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
    /*
      \`#list\` is named because it LEFT \`#reading\`.

      The day's conversations used to be stacked inside the reading column, so
      \`#reading *\` reached them. The archive draws them as a track of their own
      now, and without this line every conversation row — the largest body of
      text on that page — would have quietly stopped being contrast-checked while
      the gate went on reporting green.

      The duplicate \`#reading *\` that stood here is gone. It selected the same
      elements twice and \`querySelectorAll\` returns them once, so it never did
      anything except suggest somebody had meant to name a second place.
    */
    for (const el of document.querySelectorAll('#reading *, #list *, #page-machine *')) {
      if (el.getClientRects().length === 0) continue;
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!text) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || Number(style.opacity) < 0.5) continue;
      // Inactive controls are exempt, and WCAG 1.4.3 says so in as many words.
      // Raising one to 4.5:1 would make a thing that CANNOT be pressed look like
      // one that can, which is contract rule A1 read backwards — the same lie as
      // a day with nothing on it drawn as a button.
      //
      // Keyed on the ATTRIBUTE, never on the colour. A pale control carrying
      // neither \`disabled\` nor \`aria-disabled\` is indistinguishable from a
      // low-contrast mistake, and this gate is right to fail it.
      if (el.closest('[disabled], [aria-disabled="true"]')) continue;
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
      await settle(page)
      const below = await page.run(measureContrast)
      if (below.length > 0)
        bad('contrast', theme + ': ' + below.length + ' below the floor: ' + JSON.stringify(below))
      else ok('contrast', theme + ': every drawn text meets its floor (4.5:1, 3:1 for large)')
    }
    await page.send('Emulation.setEmulatedMedia', { features: [] })
    await settle(page)
  })

  await step('rail-lands', async () => {
    /* --- the rail is a table of contents, so every entry lands ------------- */
    /*
    From the machine's page, pressing a character in the rail did nothing
    visible. `showPlace` is the only thing that moves between the two pages and
    the rail's handler never called it, so her sheet was drawn into a column
    that was `hidden` and the window went on showing the machine.

    Pressed with the pointer rather than called: the handler is the thing under
    test, and a check that calls the function it is checking would pass on a row
    that is not wired to it at all.
  */
    await page.run(`document.getElementById('rail-machine').click()`)
    await settle(page)
    const landed = await page.run(`(() => {
    const rows = [...document.querySelectorAll('#characters .rail-row')];
    if (rows.length === 0) return { none: true };
    const first = rows[0];
    const name = first.querySelector('.rail-name').textContent.trim();
    const wasMachine = document.getElementById('page-machine').getClientRects().length > 0;
    first.click();
    return { name, wasMachine };
  })()`)
    await settle(page)
    const after = await page.run(`(() => {
    const hers = document.getElementById('page-hers');
    const machine = document.getElementById('page-machine');
    const current = document.querySelector('#characters .rail-row[aria-current="true"] .rail-name');
    return {
      hers: hers.getClientRects().length > 0,
      machine: machine.getClientRects().length > 0,
      current: current === null ? null : current.textContent.trim(),
      view: (document.querySelector('#views [aria-current="true"] .view-label') || {}).textContent,
    };
  })()`)
    if (landed.none === true)
      bad('rail-lands', 'the rail lists no characters, so nothing was pressed')
    else if (landed.wasMachine !== true)
      bad('rail-lands', 'the machine page was not showing, so the press proves nothing')
    else if (!after.hers || after.machine)
      bad(
        'rail-lands',
        'pressing ' +
          JSON.stringify(landed.name) +
          ' from the machine page left the window on the machine',
      )
    else if (after.current !== landed.name)
      bad(
        'rail-lands',
        'pressing ' +
          JSON.stringify(landed.name) +
          ' landed on her page with ' +
          JSON.stringify(after.current) +
          ' marked current',
      )
    else
      ok(
        'rail-lands',
        'pressing ' +
          JSON.stringify(landed.name) +
          ' from the machine page opens ' +
          JSON.stringify((after.view ?? '').trim()),
      )
  })

  await step('jump-lands', async () => {
    /* --- finding a setting by name takes you to it ------------------------- */
    /*
    The whole feature, end to end, and NONE of it is checkable in vitest: the
    key is bound on the window, the panel is a modal dialog in the top layer,
    and "landed on it" means an element is actually in view. The ranking is a
    pure function and `jump.test.ts` owns that; this owns the half that is only
    true once a browser has laid the window out.

    Dispatched as a real keydown on the window rather than by calling the
    opener, for `rail-lands`' reason: the binding IS the thing under test, and a
    check that calls the function it is checking passes on a key that is not
    bound at all.

    It starts from HER page on purpose. The panel has to reach a setting on the
    machine's page from somewhere that is not the machine's page — opening the
    page, opening the group and scrolling are three separate steps and only the
    first is obvious when it fails.

    THE TARGET IS A PROMPT DEEP IN THE LONG PANE, and both halves of that were
    forced by measurement.

    It first aimed at "Rest", on a pane holding three settings, and that hid a
    real bug: removing the wait that lets the pane finish drawing before the
    scroll left this check GREEN, because a pane that short shows all of its
    settings without scrolling at all. "In view" proved nothing there. The
    prompts pane draws thirty editors down one column, so a prompt near the end
    is in view only if the scroll actually ran.

    And the query has to match exactly ONE of them. It first typed a phrase two
    prompt titles share, so the panel jumped to the first while this asserted on
    the second -- passing on an element it had never navigated to, which is the
    same wrong-reason green in a subtler costume.
  */
    await goTo(page, 'cast')
    const opened = await page.run(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    const box = document.getElementById('jump');
    return { open: box.open, focused: document.activeElement === document.getElementById('jump-q') };
  })()`)
    await settle(page)
    if (opened.open !== true) {
      bad('jump-lands', 'the key did not open the panel, so nothing else here means anything')
      return
    }
    if (opened.focused !== true) bad('jump-lands', 'the panel opened without focusing its field')
    /*
      Typed as an INPUT event, because that is what the field listens for.

      Setting `.value` alone changes what is on screen and tells nothing, which
      would leave this asserting against a list drawn from an empty query.
    */
    await page.run(`(() => {
    const q = document.getElementById('jump-q');
    q.value = 'already kept';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
    /*
      THE WAIT COMES BEFORE THE SNAPSHOT, which is the whole of its value.

      It was after: the rows were read immediately, asserted on, and only then
      did this wait for the list to settle -- so the assertions ran against
      whatever draw happened to be up and the wait could not change any of them.
      An audit called it partial and was right. Reading after the list has
      settled is what makes a broken redraw fail here.
    */
    await until(
      page,
      `document.querySelectorAll('#jump-found .jump-row').length === 1`,
      'the panel to narrow to one result',
    )
    const listed = await page.run(`(() => {
    const q = document.getElementById('jump-q');
    const rows = [...document.querySelectorAll('#jump-found .jump-row')];
    return {
      rows: rows.length,
      first: (rows[0] || {}).textContent || '',
      chosen: rows.filter((r) => r.getAttribute('aria-selected') === 'true').length,
      names: q.getAttribute('aria-activedescendant'),
    };
  })()`)
    /*
      Two prompts share this phrasing -- one for each kind of recall -- so this
      also exercises the case somebody is actually in when they search thirty
      near-identical texts: more than one answer, and the arrow keys to choose.
    */
    if (listed.rows === 0) {
      bad('jump-lands', 'typing a prompt title matched nothing, so the prompts are unreachable')
      return
    }
    if (listed.chosen !== 1)
      bad('jump-lands', listed.chosen + ' rows are marked current; exactly one must be')
    if (!listed.names) bad('jump-lands', 'the field does not name its current row for a reader')
    /*
      Enter is DISPATCHED, and nothing is asserted about the dispatch itself.

      This read a value the page expression hard-coded to `true` and then checked
      it — an assertion that could not fail, which an audit caught. Whether Enter
      did anything is what the landing checks below measure; there is nothing for
      a return value to add.
    */
    await page.run(`document.getElementById('jump-q')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
    /*
      WAIT FOR THE PAGE, not for a number of milliseconds.

      Jumping opens a page, opens a group and awaits a read of the settings off
      disk before it can scroll. `goTo` makes the same argument about the same
      problem: the condition is knowable, so waiting on it beats waiting on a
      number somebody picked on one machine.
    */
    await until(
      page,
      `document.getElementById('page-machine').getClientRects().length > 0`,
      'the machine page to open after a jump',
    )
    await settle(page)
    /*
      THE MARK IS CHECKED TWICE, and the timing of each was measured rather than
      assumed.

      It is up HERE: settle waits about a hundred milliseconds and the mark runs
      for two turns of the motion duration, which is 440. Asserting it had
      already gone at this point was tried, and it failed three times out of
      three -- against code that was working.

      And it is gone by the WAIT below, which is the half that lasts. A block
      left permanently tinted reads as a state the setting is in, and the
      removal rides on an animationend that a stranded animation never fires --
      so the failure this catches is invisible except as a page that slowly
      collects highlights.
    */
    const arrived = await page.run(`(() => {
    const box = document.getElementById('jump');
    const target = [...document.querySelectorAll('[data-field]')].find((e) => e.dataset.field === 'prompt-rememberThis.alreadyThere');
    if (!target) return { missing: true, shut: !box.open };
    const seen = target.getBoundingClientRect();
    const pane = document.getElementById('machine-pane').getBoundingClientRect();
    return {
      shut: !box.open,
      group: (document.querySelector('#nav-groups .tab[aria-current="true"] .tab-label') || {}).textContent,
      /* In view means inside the pane that scrolls it, not merely in the document. */
      inView: seen.top >= pane.top - 1 && seen.bottom <= pane.bottom + 1,
      /* Nothing is left marked -- see the note above this query. */
      /* The mark is still up at this point -- see the note above, and the wait below. */
      marked: target.classList.contains('landed'),
      /* How far the setting's own top sits from the top of the pane it was scrolled in. */
      offBy: Math.round(seen.top - pane.top),
      /*
        Whether the pane could have scrolled further. It decides whether offBy
        means anything: an element at the very end of a scroller cannot reach
        the top, so a large offBy there would be the container's floor rather
        than a bad landing.
      */
      canScrollMore: document.getElementById('machine-pane').scrollTop <
        document.getElementById('machine-pane').scrollHeight - document.getElementById('machine-pane').clientHeight - 2,
    };
  })()`)
    if (arrived.missing === true)
      bad('jump-lands', 'the jump finished with no element carrying that prompt on the page')
    else if (arrived.shut !== true)
      bad('jump-lands', 'the panel stayed open over the page it opened')
    else if (arrived.inView !== true)
      bad(
        'jump-lands',
        'the prompt was reached but left outside the scrolling pane — the page opened and the scroll did not',
      )
    else if (arrived.marked !== true)
      bad('jump-lands', 'nothing marked where the jump landed, so the page moved and said nothing')
    else if (arrived.canScrollMore !== true)
      bad(
        'jump-lands',
        'the pane is scrolled to its end, so where this landed proves nothing -- pick a target further from the bottom',
      )
    else if (Math.abs(arrived.offBy) > 4)
      /*
        AT THE TOP, not merely somewhere on screen, and this is the assertion
        that protects the wait for a frame.

        "In view" was all this checked, and it passed with that wait removed:
        the scroll ran against a layout that had not settled, landed 281px from
        where it asked to be, and the setting was still visible because a pane
        is taller than one block. A jump that puts you a screenful away from the
        thing you asked for is a jump people stop trusting, and nothing about it
        looks broken in a screenshot.
      */
      bad(
        'jump-lands',
        'the setting landed ' +
          arrived.offBy +
          'px from the top of the pane, with room to scroll -- the scroll ran against a layout that had not settled',
      )
    else {
      /*
        Bounded, and it is an ASSERTION rather than a pause: until throws when
        the condition never comes true, so a mark that strands takes this check
        red instead of being waited out.
      */
      await until(
        page,
        `document.querySelectorAll('.landed').length === 0`,
        'the landing mark to fade',
      )
      ok(
        'jump-lands',
        'typing a prompt title from her page opens ' +
          JSON.stringify((arrived.group || '').trim()) +
          ' and scrolls one of its 30 editors into view (' +
          listed.rows +
          ' matched), marks it, and clears the mark',
      )
    }
  })

  await step('jump-census', async () => {
    /* --- every setting search offers is a setting the page draws ----------- */
    /*
    THE HALF vitest CANNOT SEE, for her page.

    The machine's panes are checked in `fields.test.ts`, which renders each one
    and compares the anchors it drew against the fields it declared, both
    directions. Her sheet cannot be checked that way: its builders reach for
    HTMLInputElement and querySelector, which a node test has no honest way to
    provide -- and a fake that answered them would be asserting against a tree
    the browser never builds.

    So her half is checked HERE, against the real one. A declared field that is
    never drawn is a search result that scrolls nowhere, and nothing about it
    looks wrong: the panel offers the row, the page changes, and the setting is
    not there. That is precisely the failure that accumulates one new section at
    a time until people stop trusting the search.

    The list is written out rather than read from the module, deliberately. This
    script runs against the BUILT window and importing renderer source into it
    would check the source against itself. A manifest is the same shape
    `documents.test.ts` uses for the ids this window cannot start without, and
    it has the same forcing property: a new section has to be added here.

    IT IS BOUND TO THE INDEX BY A UNIT TEST, and that binding is what makes it
    worth anything. On its own this compared the manifest only to the DOM, so
    deleting an entry from `herFields()` left the anchor drawn, this list
    satisfied and the check green while search had lost the setting.
    `fields.test.ts` parses this array and asserts it equals `herFields()`; it
    caught a missing entry the first time it ran.
  */
    await goTo(page, 'cast')
    const hers = [
      'her-who',
      'her-appearance',
      'her-size',
      'her-voice',
      'her-speech-bubble',
      'her-conversations',
      'her-face-file',
      'her-expressions',
      'her-memory',
      'her-instruction',
      'her-this-character',
    ]
    const drawn = await page.run(
      `[...document.querySelectorAll('#page-hers [data-field]')].map((e) => e.dataset.field)`,
    )
    const missing = hers.filter((one) => !drawn.includes(one))
    /*
      AND THE OTHER DIRECTION. An anchor on the page that search does not know
      about is a setting nobody can find, which is the quieter of the two and
      the one that would never be noticed.
    */
    const unlisted = drawn.filter((one) => !hers.includes(one))
    if (missing.length > 0)
      bad(
        'jump-census',
        missing.length + ' setting(s) search offers are not drawn: ' + JSON.stringify(missing),
      )
    else if (unlisted.length > 0)
      bad(
        'jump-census',
        unlisted.length +
          ' setting(s) on her page are not in the index: ' +
          JSON.stringify(unlisted),
      )
    else
      ok(
        'jump-census',
        'all ' + hers.length + ' of her sheet\u2019s settings are drawn and indexed',
      )
  })

  await step('one-masthead', async () => {
    /* --- the masthead is one component ------------------------------------- */
    /*
    Her face and her name are the same size on all three of her views.

    `HerHead.dc.html` is ONE component — a 64px face, a 34px name, and the three
    view pills — drawn identically whichever pill is current. What was built kept
    a `subject-large` class that view I alone carried, so her name was 34px on
    "Who she is" and 13px on the other two. Thirteen is the BODY TEXT SIZE: not a
    smaller heading, no heading at all, on screens whose whole subject is which
    character they are about.

    `masthead.ts` had already made this argument for the face and unified it to
    64. The name was left behind, which is the shape of defect worth a check
    rather than a comment — half a fix looks exactly like a whole one.

    Measured on the RENDERED font size and the face's box, not on a class:
    naming the class here would pass the moment somebody adds a second one.

    AND AGAINST THE DELIVERY'S NUMBERS, not only against each other. The first
    version of this check asserted the three views AGREE, which "all three wrong"
    satisfies — proved by breaking it: with the size dropped to the body rung it
    reported "her name is 13px on all three views" and passed. An invariant that
    holds when the thing it protects is destroyed is not protecting it.
  */
    const HEAD_NAME_PX = 34
    const HEAD_FACE_PX = 64
    const oneHead = await page.run(`(() => {
    const seen = [];
    for (const id of ['tab-for-cast', 'tab-for-archive', 'tab-for-permits']) {
      const tab = document.getElementById(id);
      if (tab === null) return { missing: id };
      tab.click();
      const name = document.querySelector('#subject .who-name');
      const face = document.querySelector('#subject .tile');
      if (name === null || face === null) return { blank: id };
      seen.push({
        view: (tab.textContent || '').trim(),
        px: getComputedStyle(name).fontSize,
        face: Math.round(face.getBoundingClientRect().width),
      });
    }
    return { seen, sizes: [...new Set(seen.map((o) => o.px))], faces: [...new Set(seen.map((o) => o.face))] };
  })()`)
    if (typeof oneHead.missing === 'string') {
      bad('one-masthead', `no ${oneHead.missing} tab, so the three views were never compared`)
    } else if (typeof oneHead.blank === 'string') {
      bad('one-masthead', `the masthead is empty on ${oneHead.blank}`)
    } else if (oneHead.sizes.length > 1 || oneHead.faces.length > 1) {
      bad('one-masthead', 'the masthead changes between her views: ' + JSON.stringify(oneHead.seen))
    } else if (parseFloat(oneHead.sizes[0]) !== HEAD_NAME_PX || oneHead.faces[0] !== HEAD_FACE_PX) {
      bad(
        'one-masthead',
        `the masthead agrees with itself and not with HerHead: name ${oneHead.sizes[0]} and face ` +
          `${String(oneHead.faces[0])}px, drawn at ${String(HEAD_NAME_PX)}px and ` +
          `${String(HEAD_FACE_PX)}px`,
      )
    } else {
      ok(
        'one-masthead',
        `her name is ${oneHead.sizes[0]} and her face ${String(oneHead.faces[0])}px on all three views`,
      )
    }
  })

  await step('rail-lines-up', async () => {
    /* --- the rail's rows line up ------------------------------------------- */
    /*
    A rail row's label sits immediately after its own tile, and every row in the
    character list starts at the same x.

    Written after `.rail-machine { justify-content: space-between }` outlived the
    markup it was written against. It was right for a button holding a name and
    a sub-line — it pushed them to opposite ends — and when the children became a
    tile and a name it sent the tile hard left and flushed "This machine" against
    the far edge of a 207px row, 42px past where its own tile ends.

    Nothing caught it. The class was created, the class was styled, the widths
    were unchanged, every gate stayed green, and the only symptom was a word
    sitting somewhere a word should not sit.

    TWO assertions, because there are two different claims. "A label follows its
    tile" holds for every row whatever size that tile is — it is what the flush
    caught on, and it is size-independent, so it does not overrule
    `Rail.dc.html` drawing the machine's tile at 30 against a face's 34 in a
    group of its own below the spacer. "The list lines up" is an absolute x and
    applies only inside `#characters`, which is one run of rows: that is what
    caught the dashed tile being 36px wide against a face's 34, because a canvas
    sized by attribute alone is a replaced element at `width: auto` and
    `box-sizing` has nothing to apply to.
  */
    await goTo(page, 'cast')
    await settle(page)
    const railLeft = await page.run(`(() => {
    const read = (row) => {
      const label = row.querySelector('.rail-name');
      const tile = row.querySelector('.tile, .rail-tile');
      if (label === null || tile === null) return null;
      const gap = parseFloat(getComputedStyle(row).columnGap || '0') || 0;
      return {
        name: (label.textContent || '').trim(),
        x: Math.round(label.getBoundingClientRect().left),
        after: Math.round(tile.getBoundingClientRect().right + gap),
      };
    };
    const all = [...document.querySelectorAll('.rail .rail-row')].map(read).filter(Boolean);
    const list = [...document.querySelectorAll('#characters .rail-row')].map(read).filter(Boolean);
    if (all.length < 2 || list.length < 2) return { few: all.length };
    return {
      pushed: all.filter((o) => Math.abs(o.x - o.after) > 1),
      list,
      spread: Math.max(...list.map((o) => o.x)) - Math.min(...list.map((o) => o.x)),
      rows: all.length,
    };
  })()`)
    if (typeof railLeft.few === 'number') {
      bad(
        'rail-lines-up',
        `only ${String(railLeft.few)} rows in the rail, so nothing lines up or fails to`,
      )
    } else if (railLeft.pushed.length > 0) {
      bad(
        'rail-lines-up',
        'a rail label is not beside its own tile: ' + JSON.stringify(railLeft.pushed),
      )
    } else if (railLeft.spread > 1) {
      bad(
        'rail-lines-up',
        'the character list starts its names at different places: ' + JSON.stringify(railLeft.list),
      )
    } else {
      ok(
        'rail-lines-up',
        `all ${String(railLeft.rows)} rail labels sit beside their own tile, and the ` +
          `${String(railLeft.list.length)} in the list share one left edge`,
      )
    }
  })

  await step('rule-6', async () => {
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
    await settle(page)
    /*
    EVERY GROUP, not the one that happens to be open.

    The first version of this check measured whatever the machine page was
    showing, which is one group of seven — and the twenty-seven Save buttons
    that were the whole reason for it live in the third. Removing the fix left
    it green, which is the only reason it was found: a check that cannot go red
    when the fix is deleted is not a check.
  */
    const groups = await page.run(`document.querySelectorAll('#nav-groups .tab').length`)
    const rule6 = { colours: 0, hit: [], away: false, missing: undefined, groups }
    for (let g = 0; g < groups; g += 1) {
      await page.run(
        `(() => { const t = document.querySelectorAll('#nav-groups .tab')[${String(g)}]; if (t) t.click(); })()`,
      )
      await settle(page)
      /*
      A field is measured FOCUSED as well as at rest, because her colour on a
      focus ring is the state that only exists while somebody is typing — the
      one nothing else in this window would ever show.
    */
      await page.run(
        `(() => { const f = document.querySelector('#machine-pane input, #machine-pane textarea, #machine-pane select'); if (f) f.focus(); })()`,
      )
      await settle(page)
      const round = await page.run(`(() => {
      /*
        THE PROBE SITS INSIDE A SENTINEL, and that is not fussiness.

        A custom property that does not exist makes \`color: var(--gone)\` invalid
        at computed-value time, and \`color\` is inherited — so it computes to
        whatever it inherited rather than to nothing. Probing a token that has
        been renamed therefore does not fail: it quietly puts the page's ORDINARY
        INK into the set of "her colours", and every sentence on the machine page
        is then reported as drawn in her hue.

        That is not hypothetical. This check listed five tokens, three of which
        (\`--her-hover\`, \`--her-wash\`, \`--ink-brand\`) went when the window gave
        up her hue, and the next run reported 188 hits — all of them ordinary
        text, all attributed to \`--her-hover\`.

        It is the same defect \`design-values.test.ts\` exists for, in the one file
        that test does not read. So the probe inherits a colour nothing else uses,
        and a token that resolves to it is REPORTED MISSING rather than believed.
      */
      const SENTINEL = 'rgb(1, 2, 3)';
      const holder = document.createElement('div');
      holder.style.position = 'fixed';
      holder.style.left = '-9999px';
      holder.style.color = SENTINEL;
      const probe = document.createElement('span');
      holder.append(probe);
      document.body.append(holder);
      const hers = new Map();
      const missing = [];
      for (const name of ['--her', '--her-deep', '--her-veil']) {
        probe.style.color = 'var(' + name + ')';
        const value = getComputedStyle(probe).color;
        if (value === SENTINEL) { missing.push(name); continue; }
        if (!hers.has(value)) hers.set(value, name);
      }
      holder.remove();
      if (missing.length > 0) return { missing };
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
      if (round.missing !== undefined) rule6.missing = round.missing
      else if (round.away === true) rule6.away = true
      else {
        rule6.colours = round.colours
        for (const one of round.hit) if (!rule6.hit.includes(one)) rule6.hit.push(one)
      }
    }
    if (rule6.missing !== undefined)
      bad(
        'rule-6',
        'these are not tokens any more, so this check was measuring nothing: ' +
          JSON.stringify(rule6.missing) +
          '. Update the list to what her colour is actually spent on.',
      )
    else if (rule6.away === true)
      bad('rule-6', 'the machine page is not showing, so nothing was measured')
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
    await settle(page)
  })

  await step('reduced-motion', async () => {
    /* --- if anything moves, reduced motion stills it ---------------------- */
    const moving = await page.run(`(() => [...document.querySelectorAll('*')]
    .filter((e) => e.getClientRects().length > 0)
    .filter((e) => {
      const s = getComputedStyle(e);
      return parseFloat(s.transitionDuration) > 0 || parseFloat(s.animationDuration) > 0;
    }).length)()`)
    if (moving === 0) {
      /*
        NOTHING IS MOVING RIGHT NOW, which is not the same as nothing moving.

        This said "this shell declares no transitions at all", and that stopped
        being true twice: the switch's knob moves on the fast duration, and the
        mark that says where finding a setting landed you animates on the slow
        one. Both are TRANSIENT -- a knob only animates while it is being
        thrown, and the landing mark is on an element for 440ms -- so a scan of
        what is drawn at one instant sees neither, and reporting that as "no
        motion exists" is a claim about the stylesheet made from a snapshot.

        So the branch checks what it actually can: that the vocabulary the
        motion is declared in collapses when the system asks. Both durations are
        tokens, both are zeroed by one block at the foot of tokens.css, and a
        transition that stops honouring the preference does so by being written
        with a literal duration instead of a token -- which is what this makes
        visible the moment it happens.
      */
      await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      await settle(page)
      /*
        THE TOKENS AND EVERY DECLARATION THAT USES ONE.

        Checking the two root tokens alone was not enough, and an audit said so:
        a rule written with a literal duration honours nothing, and motion on a
        pseudo-element is invisible to a scan of elements. So this reads the
        tokens AND walks every rule in every stylesheet for a non-zero duration
        that is not a token reference -- which reaches ::before and ::after,
        hidden pages, and anything not currently drawn.

        Same-origin only, so the try/catch is not defensive noise: cssRules
        throws on a cross-origin sheet and there is no way to ask first.
      */
      const stilled = await page.run(`(() => {
      const root = getComputedStyle(document.documentElement);
      const tokens = ['--duration', '--duration-fast']
        .map((one) => [one, root.getPropertyValue(one).trim()])
        .filter(([, value]) => parseFloat(value) !== 0);
      const literals = [];
      /*
        A STYLE RULE ALSO HAS cssRules, and assuming otherwise made this find
        nothing at all.

        Since CSS nesting, Chromium's CSSStyleRule implements CSSGroupingRule --
        so every ordinary rule carries an EMPTY cssRules list, which is an object
        and therefore truthy. A walk written as "if it has children, recurse and
        move on" recursed into nothing for every rule in the sheet and never read
        a single declaration. It reported zero literal durations against a
        stylesheet with one deliberately planted in it, and looked exactly like a
        pass.

        So both are done: read this rule's own declarations, THEN descend into
        whatever children it actually has.
      */
      const walk = (list) => {
        for (const rule of list) {
          if (rule.cssRules && rule.cssRules.length > 0) walk(rule.cssRules);
          if (!rule.style) continue;
          for (const prop of ['animation-duration', 'transition-duration']) {
            const value = rule.style.getPropertyValue(prop);
            if (!value) continue;
            const seconds = value.split(',').map((one) => parseFloat(one) || 0);
            if (seconds.some((one) => one > 0))
              literals.push((rule.selectorText || rule.cssText.slice(0, 40)) + ' :: ' + prop + ': ' + value);
          }
        }
      };
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules } catch { continue }
        walk(rules);
      }
      return [...tokens, ...literals.slice(0, 5)];
    })()`)
      await page.send('Emulation.setEmulatedMedia', { features: [] })
      await settle(page)
      if (stilled.length > 0)
        bad('reduced-motion', 'motion survives the preference: ' + JSON.stringify(stilled))
      else
        ok(
          'reduced-motion',
          'nothing is mid-motion; both durations zero and no rule hard-codes one',
        )
    } else {
      await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      await settle(page)
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
  })

  await step('one-title-bar', async () => {
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
  })
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
  await step('fits', async () => {
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
      bad(
        'fits',
        squashed.length + ' controls cut off their own label: ' + JSON.stringify(squashed),
      )
    else ok('fits', 'every control and name fits the width it is given')
  })

  await step('clipping', async () => {
    /* --- nothing clips out of the window ---------------------------------- */
    const clipped = await page.run(`(() => {
    const room = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('#reading *, #list *, #page-machine *')) {
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
  })
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
  // Assigned to the module-level `running` so the watchdog can reach it.
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
    /*
      Wait for the SECOND ROW, not for three seconds.

      Duplicating a character is a write, a re-read and a redraw, and three
      seconds was the number that covered it on the machine this was written on.
      The rail showing two rows is the thing that was being waited for, and it
      says so about 200ms in.
    */
    await until(
      page,
      `document.querySelectorAll('.rail .rail-row').length > 1`,
      'the seeded character',
      8000,
    )
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
    // The window is open as soon as `openShell` returns; what this was waiting
    // for is the first read landing and the rail being drawn from it.
    await until(
      page,
      `document.querySelectorAll('.rail .rail-row').length > 0`,
      'the rail to draw',
      10000,
    )
    await settle(page)

    if (fresh) {
      await firstHour(page)
      page.close()
      return
    }
    if (process.argv.includes('--outline')) await outline(page)
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
      tight. `window.ts` enforces 1120×680; a check that never sees it is a
      check that passes on the developer's monitor.

      The floor moved with the v2 delivery, and this is where it earns its keep:
      at 1120 the apparatus column collapses and the conversation list drops from
      368 to 328, so the floor is a DIFFERENT layout rather than a squeezed one.
      A gate that only ever measured the default would never see it.
    */
    // Filming starts here rather than at launch: everything before this is the
    // app building its own store and a character being duplicated through the
    // UI, which is setup rather than the gate.
    filmOn(page)
    await checks(page)
    await layoutChecks(page)
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1120,
      height: 680,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await settle(page)
    await layoutChecks(page, 'at the 1120px floor')

    /*
      AND WIDE, which is where a missing cap hides.

      The floor catches things that stop fitting. A cap that does nothing is the
      opposite failure and only shows the other way: the transcript's track is
      616 at the default, so `max-width: 600` looked redundant there and the
      column grew with the window — her turns ran to about 936px at 1600, on the
      one surface in this window where a long line costs the most.
    */
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 900,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await settle(page)
    /*
      `at` is the suffix `layoutChecks` sets for the width it ran at, and it is
      module state — so a check running after that pass inherited "[at the 1120px
      floor]" while measuring at 1600. Cleared here rather than in `ok`, because
      the suffix is right for the checks that set it.
    */
    at = ''
    await step('measure-holds', async () => {
      const wide = await page.run(`(() => {
        const at = document.getElementById('tab-for-archive');
        if (at) at.click();
        const row = document.querySelector('#list .entry');
        if (row) row.click();
        return null;
      })()`)
      void wide
      await new Promise((r) => setTimeout(r, 400))
      const held = await page.run(`(() => {
        const caps = [
          ['the transcript', '.transcript', 600],
          ['a field on her page', '.sheet input[type=text]', 420],
          ['her size slider', '.size-slider', 300],
        ];
        const over = [];
        for (const [what, sel, cap] of caps) {
          for (const el of document.querySelectorAll(sel)) {
            if (el.getClientRects().length === 0) continue;
            const w = Math.round(el.getBoundingClientRect().width);
            if (w > cap + 1) over.push(what + ' is ' + w + ' against a cap of ' + cap);
          }
        }
        return { over, width: window.innerWidth };
      })()`)
      if (held.over.length > 0)
        bad('measure-holds', `at ${String(held.width)}px: ` + held.over.join('; '))
      else ok('measure-holds', `nothing outruns its measure at ${String(held.width)}px`)
    })
    await page.send('Emulation.clearDeviceMetricsOverride')

    // The last frame, so the recording ends on the state the gate left rather
    // than mid-transition, then the file is written before the app goes.
    await filmFrame()
    page.close()
  } finally {
    if (running) await stop(running, { last: true })
    rmSync(userData, { recursive: true, force: true })
  }
  const filmed = await filmOff()
  if (filmed !== null) {
    console.log(
      `\n  film  ${filmed.out}\n        ${String(filmed.frames)} frames, about ${filmed.seconds}s`,
    )
  }
  console.log(
    LISTING
      ? `\n${listed.length} checks — name any of them with --only, or match with --grep`
      : failures.length
        ? `\n${failures.length} failed`
        : `\n${passes.length} checks, all green${
            skipped.length ? ` \u00b7 ${String(skipped.length)} not asked for` : ''
          }`,
  )
  process.exit(failures.length ? 1 : 0)
}

/*
  The launched app, at MODULE scope so the watchdog can kill it.

  It was a `let` inside `main`, which the watchdog cannot see — so the kill added
  there would have thrown `ReferenceError` at the one moment it exists to work.
  Caught by reading the scope rather than by a timeout happening.
*/
let running = null

/*
  The budget is a HANG detector, and it has to know how much work it asked for.

  A plain run is about 7 seconds; `--outline` adds fourteen screen dumps, each
  with two view hops, three settles and a full `getComputedStyle` walk. Measured
  on this machine: 130s on a good run and past 240s on a slow one, from the same
  commit — so the old flat four minutes was not catching a hang on the outline
  path, it was failing a run that was merely working.

  That mattered more than a red line: a run killed partway used to leave the
  screens it never reached holding a PREVIOUS run's output, and one of those was
  read as current hours later. `outline` empties the directory first now, so the
  answer to being killed is an absent file rather than a stale one — but the
  budget should still fit the job.
*/
const BUDGET_MS = process.argv.includes('--outline') ? 600_000 : 240_000

const watchdog = setTimeout(() => {
  console.error(
    `\nthe gate ran past ${String(BUDGET_MS / 60_000)} minutes — failing rather than hanging`,
  )
  /*
    TAKE THE APP WITH IT. `process.exit` skips `main`'s `finally`, so a timeout
    left the detached Electron alive holding the debugging port — and the next
    run then waits for a target that will never match, which reads as a slow
    launch rather than as a stale process. Seen for real today, twice.
  */
  if (running) {
    try {
      process.kill(-running.app.pid, 'SIGKILL')
    } catch {
      running.app.kill('SIGKILL')
    }
  }
  process.exit(1)
}, BUDGET_MS)
/*
  NOT `unref`ed, and that one word was the hole in this whole arrangement.

  An unref'd timer explicitly does not keep the event loop alive. So the one
  case the watchdog exists for — `main` hanging on something that never settles,
  an Electron launch or a debugging-port connect that gets no answer — was the
  case it could not catch: with nothing else pending, the loop DRAINED, and Node
  ended the process for an unsettled top-level await before the budget was
  anywhere near spent.

  That exit code is 13, and the failure is close to silent. `pnpm` reports
  `ELIFECYCLE Command failed with exit code 13` and nothing else, and none of
  the text above ever prints — no budget message, no failing check, no clue that
  a gate ran at all. Worse, the kill below is skipped too, so the detached
  Electron survives holding the debugging port, which is the exact stale-process
  hang the comment above says was "seen for real today, twice". A silent 13 was
  therefore not just a lost run, it poisoned the next one.

  Reproduced before changing it, at three seconds rather than four minutes:
  `setTimeout(...).unref()` with a promise that never settles exits 13 without
  firing; the same script without the `unref` prints its message and exits 1.

  `clearTimeout` in a `finally` is what the `unref` was reaching for. A normal
  run always ends in `process.exit`, so the timer could never have delayed one —
  but if `main` ever returns instead, this stops a pending four-minute timer
  holding the process open, without also disarming the watchdog.
*/
try {
  await main()
} finally {
  clearTimeout(watchdog)
}
