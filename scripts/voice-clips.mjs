#!/usr/bin/env node
/**
 * The ten voice samples the picker plays, made by the voice they sample.
 *
 *     node scripts/voice-clips.mjs           make any that are missing
 *     node scripts/voice-clips.mjs --force   remake all ten
 *     node scripts/voice-clips.mjs --check   verify the committed set, write nothing
 *
 * ## Why these are recorded rather than synthesised at run time
 *
 * Choosing a voice is a COMPARISON: you want cedar, then marin, then cedar
 * again, inside a few seconds. Opening a Realtime session per press makes every
 * comparison a network connection, needs a live Codex login, and cannot work
 * offline — for a control somebody uses once. Ten files answer the same question
 * instantly and forever.
 *
 * ## What it costs to run
 *
 * Ten short Realtime sessions on the ChatGPT subscription the app already uses.
 * That is the whole reason this is a script somebody runs deliberately rather
 * than a build step: it spends an account.
 *
 * ## The line, and why it is the same for all ten
 *
 * A preview is only useful if the only variable is the voice. Same words, same
 * instruction, same model — so what you hear between two clips is the
 * difference between two voices and nothing else.
 *
 * ## Format
 *
 * The service returns PCM16 at 24kHz mono. Ogg Opus at 24kbps takes each clip
 * from ~146KB to ~8KB with no audible cost at this length, and Opus in Ogg is
 * the one compressed format Chromium is guaranteed to play — Electron's ffmpeg
 * build cannot be relied on for AAC.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INTO = join(ROOT, 'src', 'renderer', 'voices')

/** Kept in step with `VOICE_NAMES` in `src/shared/persona.ts` — checked below. */
const VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'cedar',
  'marin',
]

const MODEL = 'gpt-realtime-2.1'
const LINE = 'Hey — this is how I sound.'
const HOW = 'Say exactly the words you are given, once, warmly and unhurried. Add nothing.'

/** Below this a "clip" is a truncated download or a refusal, not a recording. */
const LEAST_BYTES = 1500
const LEAST_SECONDS = 1.2
const MOST_SECONDS = 8

/**
 * The list here and the list the app offers must not drift.
 *
 * A voice added to `persona.json` handling with no clip beside it is a pill
 * that silently plays nothing, which is worse than a picker with no preview at
 * all — the control looks like it works.
 */
function checkTheListMatches() {
  const source = readFileSync(join(ROOT, 'src', 'shared', 'persona.ts'), 'utf8')
  const block = /export const VOICE_NAMES = \[([\s\S]*?)\] as const/.exec(source)
  if (block === null) throw new Error('cannot find VOICE_NAMES in src/shared/persona.ts')
  const named = [...block[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
  const missing = named.filter((one) => !VOICES.includes(one))
  const extra = VOICES.filter((one) => !named.includes(one))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `this script and VOICE_NAMES disagree — missing here: ${JSON.stringify(missing)}, ` +
        `not offered by the app: ${JSON.stringify(extra)}`,
    )
  }
}

/** The subscription token the app itself runs on. Never printed. */
function bearer() {
  const home = process.env['CODEX_HOME'] ?? join(homedir(), '.codex')
  const path = join(home, 'auth.json')
  if (!existsSync(path)) throw new Error(`no Codex login at ${path} — run \`codex\` once`)
  const token = JSON.parse(readFileSync(path, 'utf8'))?.tokens?.access_token
  if (typeof token !== 'string' || token === '') {
    throw new Error(`${path} has no access_token — run \`codex\` to sign in`)
  }
  return token
}

/**
 * A short-lived key, because a WebSocket cannot carry an Authorization header.
 *
 * `openai-insecure-api-key.<key>` as a subprotocol is the documented browser
 * path and it takes an ephemeral secret, so the account bearer never goes near
 * the socket. Note there is deliberately NO `openai-beta.realtime-v1`
 * subprotocol: asking for the beta shape is refused outright now —
 * `beta_api_shape_disabled`, "Please use /v1/realtime for the GA API".
 */
async function ephemeralKey(token) {
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: { type: 'realtime', model: MODEL } }),
  })
  if (!res.ok) {
    throw new Error(`minting a key failed: HTTP ${String(res.status)} ${await res.text()}`)
  }
  const key = (await res.json()).value
  if (typeof key !== 'string' || key === '') throw new Error('the mint returned no key')
  return key
}

/** One session, one voice, one sentence — resolved with the raw PCM she spoke. */
async function record(key, voice) {
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, [
    'realtime',
    `openai-insecure-api-key.${key}`,
  ])
  const chunks = []
  let failed = null
  const finished = new Promise((resolve, reject) => {
    const stop = setTimeout(() => {
      reject(new Error(`${voice}: nothing finished within 45s`))
    }, 45_000)
    const end = (why) => {
      clearTimeout(stop)
      try {
        ws.close()
      } catch {
        /* already closing */
      }
      if (failed !== null) reject(new Error(`${voice}: ${failed}`))
      else resolve(why)
    }
    ws.addEventListener('error', () => {
      clearTimeout(stop)
      reject(new Error(`${voice}: socket error`))
    })
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            output_modalities: ['audio'],
            audio: { output: { voice } },
            instructions: HOW,
          },
        }),
      )
      ws.send(
        JSON.stringify({
          type: 'response.create',
          response: { instructions: `Say exactly: ${LINE}` },
        }),
      )
    })
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data)
      // `response.output_audio.delta` on the GA shape. Matched by suffix so an
      // older or renamed audio event still lands rather than silently producing
      // a zero-byte clip.
      if (frame.type.endsWith('audio.delta') && typeof frame.delta === 'string') {
        chunks.push(Buffer.from(frame.delta, 'base64'))
      }
      if (frame.type === 'error') {
        failed = JSON.stringify(frame.error)
        end('error')
      }
      if (frame.type === 'response.done') end('done')
    })
  })
  await finished
  const pcm = Buffer.concat(chunks)
  if (pcm.length === 0) throw new Error(`${voice}: the session finished having spoken nothing`)
  return pcm
}

function encode(pcm, path) {
  execFileSync(
    'ffmpeg',
    // prettier-ignore
    ['-y', '-loglevel', 'error',
     '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
     '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', path],
    { input: pcm },
  )
}

/** What is actually on disk, judged rather than listed. */
function inspect() {
  const bad = []
  for (const voice of VOICES) {
    const path = join(INTO, `${voice}.ogg`)
    if (!existsSync(path)) {
      bad.push(`${voice}: missing`)
      continue
    }
    const bytes = statSync(path).size
    if (bytes < LEAST_BYTES) {
      bad.push(`${voice}: ${String(bytes)} bytes — too small to be a recording`)
      continue
    }
    let seconds = 0
    try {
      seconds = Number(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'csv=p=0',
          path,
        ]).toString(),
      )
    } catch {
      bad.push(`${voice}: ffprobe could not read it`)
      continue
    }
    if (!(seconds >= LEAST_SECONDS && seconds <= MOST_SECONDS)) {
      bad.push(
        `${voice}: ${seconds.toFixed(2)}s is outside ${String(LEAST_SECONDS)}–${String(MOST_SECONDS)}s`,
      )
    }
  }
  const strays = existsSync(INTO)
    ? readdirSync(INTO)
        .filter((one) => one.endsWith('.ogg'))
        .filter((one) => !VOICES.includes(one.replace('.ogg', '')))
    : []
  for (const one of strays) bad.push(`${one}: not a voice this app offers`)
  return bad
}

async function main() {
  checkTheListMatches()
  const args = process.argv.slice(2)

  if (args.includes('--check')) {
    const bad = inspect()
    if (bad.length > 0) {
      console.error('The voice clips are not right:')
      for (const one of bad) console.error(`  ${one}`)
      process.exit(1)
    }
    console.log(`all ${String(VOICES.length)} voice clips present and plausible`)
    return
  }

  mkdirSync(INTO, { recursive: true })
  const force = args.includes('--force')
  const token = bearer()
  let made = 0
  for (const voice of VOICES) {
    const path = join(INTO, `${voice}.ogg`)
    if (!force && existsSync(path)) {
      console.log(`  kept    ${voice}`)
      continue
    }
    const pcm = await record(await ephemeralKey(token), voice)
    encode(pcm, path)
    made += 1
    console.log(
      `  made    ${voice}  ${(pcm.length / 48000).toFixed(2)}s  ${String(statSync(path).size)} bytes`,
    )
  }
  console.log(`${String(made)} recorded, ${String(VOICES.length - made)} already there`)

  const bad = inspect()
  if (bad.length > 0) {
    console.error('...but the result does not check out:')
    for (const one of bad) console.error(`  ${one}`)
    process.exit(1)
  }
}

await main()
