/**
 * The face tuner.
 *
 * It drives the SAME `MochiAvatar` the app renders, over a mutable copy of
 * `MOCHI`. That coupling is the whole design: a tuner holding its own geometry
 * would drift from the avatar the first time either changed, and a drifted
 * tuner still looks authoritative, which is worse than not having one.
 *
 * Everything here is UI. If a line of it looks like it belongs to the face,
 * it belongs in `rig/` instead.
 */

import { EMOTIONS, type Emotion } from '@shared/avatar'
import trace from '@rig/__fixtures__/her-voice.json' with { type: 'json' }
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import { MochiAvatar } from '@rig/mochi'
import { EnvelopeMouth } from '@rig/mouth'
import { COLOURS, GROUPS } from './schema'

type MutableFace = { -readonly [K in keyof FaceSpec]: FaceSpec[K] }

/** One object, shared by the stage and all eight thumbnails, mutated in place. */
const face: MutableFace = { ...MOCHI }

let emotion: Emotion = 'neutral'
let intensity = 1
let idle = true
let talking = false

const $ = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element: ${id}`)
  return found as T
}

/** Size a canvas in CSS pixels and return the device pixel ratio it was built for. */
function fit(canvas: HTMLCanvasElement, width: number, height: number): number {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  return dpr
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not acquire a 2D drawing context')
  return ctx
}

// ── stage ───────────────────────────────────────────────────────────────────

const STAGE = { width: 520, height: 420 }
const stageCanvas = $<HTMLCanvasElement>('stageCanvas')
const stageDpr = fit(stageCanvas, STAGE.width, STAGE.height)
// The tuner lays out its own stage and grid, so she fits what she is given.
const stage = new MochiAvatar(context(stageCanvas), { face, size: 'fit-canvas' })
stage.resize(STAGE.width, STAGE.height, stageDpr)

stageCanvas.addEventListener('mousemove', (event) => {
  const bounds = stageCanvas.getBoundingClientRect()
  stage.lookAt(
    (event.clientX - bounds.left) / bounds.width,
    (event.clientY - bounds.top) / bounds.height,
  )
})
stageCanvas.addEventListener('mouseleave', () => stage.lookAt(0.5, 0.5))
stageCanvas.addEventListener('click', () => stage.poke())

/**
 * "Talking" replays HER, not a synthetic signal.
 *
 * `her-voice.json` is a recording: the RMS of gpt-realtime's output over
 * WebRTC, captured from a live session. It runs through the same
 * `EnvelopeMouth` the app will use, so what you see here is what she does --
 * including the parts a sine wave would never have shown, like how long her
 * mouth takes to settle after a syllable and how the gaps between her words
 * actually look.
 */
const mouth = new EnvelopeMouth(stage)
/** Position in the recording, in samples. Fractional, advanced by real time. */
let playhead = 0
let lastFrameMs: number | null = null
let wasTalking = false

function frame(now: number): void {
  // TWO deltas. `elapsed` is the time that passed; `dt` is how much of it the
  // envelope integrator will take in one step, capped so a dropped frame or a
  // suspended tab cannot make the mouth lurch.
  //
  // The playhead runs on `elapsed`. It used to run on the capped figure, which
  // silently contradicted the comment below it: after any hitch longer than
  // 50ms the recording played SLOWER than real time, so the preview drifted out
  // of step with the audio behaviour it exists to reproduce -- and the whole
  // point of this tool is judging timing by eye.
  const elapsed = lastFrameMs === null ? 1 / 60 : (now - lastFrameMs) / 1000
  const dt = Math.min(elapsed, 1 / 20)
  lastFrameMs = now

  if (talking) {
    // Advanced by elapsed time rather than one sample per frame, so the
    // recording plays at its true rate whatever the display is doing.
    playhead = (playhead + (elapsed * 1000) / trace.sampleMs) % trace.rms.length
    mouth.observe(trace.rms[Math.floor(playhead)] ?? 0, dt)
  } else if (wasTalking) {
    mouth.end()
    playhead = 0
  }
  wasTalking = talking

  stage.render(now)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// ── contact sheet ───────────────────────────────────────────────────────────

const CELL = { width: 150, height: 140 }
const cells = EMOTIONS.map((name) => {
  const wrapper = document.createElement('div')
  wrapper.className = 'cell'
  const canvas = document.createElement('canvas')
  const label = document.createElement('span')
  label.textContent = name
  wrapper.append(canvas, label)
  $('sheet').append(wrapper)

  const dpr = fit(canvas, CELL.width, CELL.height)
  const avatar = new MochiAvatar(context(canvas), { face, size: 'fit-canvas' })
  avatar.resize(CELL.width, CELL.height, dpr)
  avatar.setIdle(false)
  return { name, avatar }
})

/**
 * Advances the contact sheet's clock, so each redraw is a NEW instant.
 *
 * `render(0)` every time gave the squash spring a delta of zero on every frame
 * after the first, and a spring integrating no time does not move: changing the
 * emotion or the intensity updated the target and the sheet went on showing the
 * pose from the very first draw. The squash column of a squash-tuning tool was
 * frozen.
 */
let sheetMs = 0

/** Long enough for the spring to reach its target from rest, at 60Hz. */
const SETTLE_FRAMES = 90

function drawSheet(): void {
  for (const cell of cells) {
    cell.avatar.setEmotion({ emotion: cell.name, intensity })
    // Simulated to REST from a deterministic sequence, rather than shown
    // mid-flight. The sheet is a comparison of eight settled poses; a single
    // step would show eight springs at whatever phase the last edit left them
    // in, which is not a comparison of anything.
    for (let i = 1; i <= SETTLE_FRAMES; i++) cell.avatar.render(sheetMs + i * (1000 / 60))
  }
  sheetMs += SETTLE_FRAMES * (1000 / 60)
}

// ── controls ────────────────────────────────────────────────────────────────

/** Pushed by every control so `reset` has one way to put the UI back. */
const syncers: Array<() => void> = []

function refresh(): void {
  drawSheet()
  writeExport()
}

function addRow(
  host: HTMLElement,
  label: string,
  input: HTMLInputElement,
  read: () => string,
): void {
  const row = document.createElement('div')
  row.className = 'row'
  const caption = document.createElement('label')
  caption.textContent = label
  const output = document.createElement('output')
  row.append(caption, input, output)
  host.append(row)

  const sync = (): void => {
    output.textContent = read()
  }
  sync()
  syncers.push(sync)
  input.addEventListener('input', () => {
    sync()
    refresh()
  })
}

function addSection(title: string, open: boolean, build: (host: HTMLElement) => void): void {
  const details = document.createElement('details')
  details.className = 'section'
  details.open = open
  const summary = document.createElement('summary')
  summary.textContent = title
  const rows = document.createElement('div')
  rows.className = 'rows'
  details.append(summary, rows)
  build(rows)
  $('sections').append(details)
}

const decimals = (step: number): number => (step < 1 ? 2 : 0)

/**
 * One control, bound to one field of the face.
 *
 * The slider and the colour swatch were written out separately and differed
 * only in the input's type, the attributes it carries, and how a string becomes
 * a value and back. Everything else — create, seed from the model, register the
 * reset syncer, write on input, add the row — was the same five steps twice,
 * and the failure mode of that is a fix landing on one kind of control and not
 * the other.
 */
function bindControl<K extends keyof FaceSpec>(
  host: HTMLElement,
  key: K,
  label: string,
  attributes: Readonly<Record<string, string>>,
  parse: (raw: string) => FaceSpec[K],
  show: (value: FaceSpec[K]) => string,
): void {
  const input = document.createElement('input')
  for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value)
  // Seeded from the model and re-seeded on reset, so the control never asserts
  // a value the face does not hold.
  const apply = (): void => {
    input.value = String(face[key])
  }
  apply()
  syncers.push(apply)
  input.addEventListener('input', () => {
    face[key] = parse(input.value)
  })
  addRow(host, label, input, () => show(face[key]))
}

for (const group of GROUPS) {
  addSection(group.title, group.open ?? false, (host) => {
    for (const slider of group.sliders) {
      bindControl(
        host,
        slider.key,
        slider.label,
        {
          type: 'range',
          min: String(slider.min),
          max: String(slider.max),
          step: String(slider.step),
        },
        Number,
        (value) => value.toFixed(decimals(slider.step)),
      )
    }
  })
}

addSection('colour', false, (host) => {
  for (const { key, label } of COLOURS) {
    bindControl(
      host,
      key,
      label,
      { type: 'color' },
      (raw) => raw,
      (value) => value.replace('#', ''),
    )
  }
})

const emosHost = $('emos')
for (const name of EMOTIONS) {
  const button = document.createElement('button')
  button.textContent = name
  button.classList.toggle('on', name === emotion)
  button.addEventListener('click', () => {
    emotion = name
    stage.setEmotion({ emotion, intensity })
    for (const other of emosHost.children) other.classList.toggle('on', other === button)
  })
  emosHost.append(button)
}

const intensityInput = $<HTMLInputElement>('intensity')
intensityInput.addEventListener('input', () => {
  intensity = Number(intensityInput.value)
  $('intensityOut').textContent = intensity.toFixed(2)
  stage.setEmotion({ emotion, intensity })
  drawSheet()
})

function toggleGroup(buttons: Iterable<Element>, active: Element): void {
  for (const button of buttons) button.classList.toggle('on', button === active)
}

const backgrounds = document.querySelectorAll<HTMLButtonElement>('[data-bg]')
for (const button of backgrounds) {
  button.addEventListener('click', () => {
    $('stage').className = `stage ${button.dataset['bg'] ?? 'light'}`
    toggleGroup(backgrounds, button)
  })
}

const idleBtn = $<HTMLButtonElement>('idleBtn')
idleBtn.addEventListener('click', () => {
  idle = !idle
  stage.setIdle(idle)
  idleBtn.classList.toggle('on', idle)
})

const talkBtn = $<HTMLButtonElement>('talkBtn')
talkBtn.addEventListener('click', () => {
  talking = !talking
  talkBtn.classList.toggle('on', talking)
})

$('pokeBtn').addEventListener('click', () => stage.poke())

$('resetBtn').addEventListener('click', () => {
  Object.assign(face, MOCHI)
  for (const sync of syncers) sync()
  refresh()
})

// ── export ──────────────────────────────────────────────────────────────────

const format = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))

function writeExport(): void {
  const lines = [
    ...GROUPS.flatMap((group) => [
      `  // ${group.title}`,
      ...group.sliders.map((slider) => `  ${slider.key}: ${format(face[slider.key])},`),
    ]),
    '  // colour',
    ...COLOURS.map(({ key }) => `  ${key}: '${face[key]}',`),
  ]
  $('out').textContent = `export const MOCHI: FaceSpec = {\n${lines.join('\n')}\n}`
}

/**
 * The button's real label, captured once.
 *
 * Read from the button on every click before, so a second click within the
 * 1200ms window captured `copied ✓` as the "previous" text and restored the
 * button to that permanently. Two competing timers, and the later one wins.
 */
const COPY_LABEL = $('copyBtn').textContent ?? 'copy'
let copyTimer: ReturnType<typeof setTimeout> | null = null

function flashCopyButton(message: string): void {
  const button = $('copyBtn')
  button.textContent = message
  if (copyTimer !== null) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    button.textContent = COPY_LABEL
    copyTimer = null
  }, 1200)
}

$('copyBtn').addEventListener('click', () => {
  // AWAITED, and the rejection handled. `writeText` rejects when the clipboard
  // permission is refused or the page is not a secure context, and the bare
  // `void ... .then()` turned that into an unhandled rejection while the button
  // sat there saying nothing -- so a copy that silently did not happen looked
  // exactly like one that did.
  void navigator.clipboard.writeText($('out').textContent ?? '').then(
    () => flashCopyButton('copied ✓'),
    (error: unknown) => {
      console.error('[tuner] could not copy:', error)
      flashCopyButton('copy failed')
    },
  )
})

stage.setEmotion({ emotion, intensity })
refresh()
