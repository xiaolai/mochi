/**
 * The real process behind a delegation.
 *
 * Its own module for one reason: it lived in `index.ts`, which imports electron
 * and therefore cannot be loaded by a test -- so the only test of the kill path
 * supplied its own `RunHandle` and asserted against that. It passed while
 * production discarded the signal entirely, which is exactly how a dead
 * SIGKILL escalation survived a whole audit round. A module boundary here is
 * what lets the assertion point at the code that actually runs.
 */

import { spawn } from 'node:child_process'
import type { RunHandle } from './delegate'

/** Bounded: this is another program's diagnostics, and its size is not ours. */
const MAX_STDERR = 8192

export function spawnCodex(path: string, args: readonly string[]): RunHandle {
  const child = spawn(path, [...args], {
    windowsHide: true,
    // NO shell. The question is one argv entry and nothing parses it but the
    // process itself -- see `locate.ts` for why the path is resolved too.
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (stderr.length < MAX_STDERR) stderr += chunk.slice(0, MAX_STDERR - stderr.length)
  })
  return {
    finished: new Promise((resolve) => {
      child.on('error', () => resolve({ code: null, stderr }))
      child.on('close', (code) => resolve({ code, stderr }))
    }),
    // The SIGNAL is forwarded. Dropping it made the deadline's escalation inert
    // in production while the test -- which supplied its own adapter -- went on
    // passing.
    kill: (signal?: NodeJS.Signals) => child.kill(signal),
  }
}
