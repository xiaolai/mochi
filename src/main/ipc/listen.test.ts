import { describe, expect, it, vi } from 'vitest'

/**
 * `ipcMain.on` has nowhere to put an exception.
 *
 * `handle` returns a promise, so a throw inside one becomes a rejection the
 * renderer sees — unpleasant, contained, reportable. `on` is invoked from
 * Electron's event loop with no frame above it, so an exception escapes into
 * the main process with nothing that knows what it was doing.
 *
 * Eleven of this app's twelve one-way listeners were unguarded, and every one
 * calls into something that genuinely throws: the archive, the persona store,
 * `webContents.send` on a window that can die mid-call.
 */

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
      handlers.set(channel, handler)
    },
  },
}))

const { listener } = await import('./listen')

describe('a one-way channel that throws', () => {
  it('does not let the exception escape', () => {
    const listen = listener(() => undefined)
    listen('boom', () => {
      throw new Error('the window is gone')
    })
    expect(() => handlers.get('boom')?.({})).not.toThrow()
  })

  it('reports it, naming the channel', () => {
    // A report naming the channel is worth more than one naming the process,
    // which is what the `uncaughtException` backstop would have given.
    const noted: { channel: string; detail: string }[] = []
    const listen = listener((channel, detail) => noted.push({ channel, detail }))
    listen('named', () => {
      throw new Error('specific failure')
    })
    handlers.get('named')?.({})
    expect(noted).toHaveLength(1)
    expect(noted[0]?.channel).toBe('named')
    expect(noted[0]?.detail).toContain('specific failure')
  })

  it('passes the event and every argument through when it does not throw', () => {
    const seen: unknown[] = []
    const listen = listener(() => undefined)
    listen('fine', (event, ...args) => seen.push(event, ...args))
    handlers.get('fine')?.({ sender: 1 }, 'a', 2, null)
    expect(seen).toEqual([{ sender: 1 }, 'a', 2, null])
  })

  it('keeps working after one call throws', () => {
    // The listener stays registered: one bad message must not deafen the
    // channel for the rest of the session.
    let calls = 0
    const listen = listener(() => undefined)
    listen('again', () => {
      calls += 1
      if (calls === 1) throw new Error('first one')
    })
    handlers.get('again')?.({})
    handlers.get('again')?.({})
    expect(calls).toBe(2)
  })
})
