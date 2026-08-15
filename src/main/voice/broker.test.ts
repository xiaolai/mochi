/**
 * The broker's readiness, and the watchers that clear it.
 *
 * This file exists because of one defect and the reason nothing found it: the
 * broker had no tests at all. `watchReload` was written to clear `ready` when
 * the renderer that set it goes away — and it was called once, from
 * `register()`, which runs inside `prepare()` while the companion window is
 * still null. So it returned immediately, every time, and the listeners it
 * exists to install had never been installed in any run since the day they
 * were written. `ready` stayed set-once-never-cleared, which is precisely the
 * bug its own comment says it fixed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
      handlers.set(channel, handler)
    },
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
      handlers.set(channel, handler)
    },
  },
}))

const { createVoiceBroker } = await import('./broker')
const { IPC } = await import('@shared/ipc')

/** A window whose listeners and sends the test can read. */
function fakeWindow() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const sent: unknown[][] = []
  return {
    listeners,
    sent,
    webContents: {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
      },
      send: (...args: unknown[]) => {
        sent.push(args)
      },
    },
  }
}

const command = { kind: 'close' as const, attempt: 1 }

function brokerOver(target: () => ReturnType<typeof fakeWindow> | null) {
  return createVoiceBroker({
    target: () => target() as never,
    isFromCompanion: () => true,
    onReport: vi.fn(),
    currentAttempt: () => 1,
    credential: vi.fn(),
  })
}

beforeEach(() => {
  handlers.clear()
})

describe('clearing readiness when the renderer goes away', () => {
  it('watches a window that did not exist when the broker registered', () => {
    // The ordering that made this dead code. `register()` runs inside
    // `prepare()`; the companion window is created in `start()`, after it. A
    // watcher attached at registration time therefore attaches to nothing.
    let window: ReturnType<typeof fakeWindow> | null = null
    const broker = brokerOver(() => window)
    broker.register()

    // No window yet, so nothing to watch -- and nothing attached.
    expect(window).toBeNull()

    window = fakeWindow()
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })
    broker.send(command)

    // The listeners are on NOW, on the window that actually exists.
    expect([...window.listeners.keys()].sort()).toEqual([
      'did-start-navigation',
      'render-process-gone',
    ])
  })

  it('holds commands again after the renderer navigates away', () => {
    // What the watcher is for. `ready` was set once and never cleared, so main
    // went on sending to a document that had never subscribed and the commands
    // vanished instead of queueing.
    const window = fakeWindow()
    const broker = brokerOver(() => window)
    broker.register()
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })

    broker.send(command)
    expect(window.sent).toHaveLength(1)

    // A main-frame navigation that is not in-place: the document is replaced.
    window.listeners.get('did-start-navigation')?.({}, 'about:blank', false, true)
    broker.send(command)

    // Held, not sent to a document that never subscribed.
    expect(window.sent).toHaveLength(1)

    // And flushed once the replacement says it is listening.
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })
    expect(window.sent.length).toBeGreaterThan(1)
  })

  it('holds commands again after the renderer process is gone', () => {
    const window = fakeWindow()
    const broker = brokerOver(() => window)
    broker.register()
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })
    broker.send(command)
    expect(window.sent).toHaveLength(1)

    window.listeners.get('render-process-gone')?.()
    broker.send(command)
    expect(window.sent).toHaveLength(1)
  })

  it('watches a replacement window as well as the first', () => {
    // A recreated companion brings a new `webContents`. Watching by window, or
    // watching once, would leave the replacement unwatched.
    let window = fakeWindow()
    const broker = brokerOver(() => window)
    broker.register()
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })
    broker.send(command)

    const replacement = fakeWindow()
    window = replacement
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })
    broker.send(command)

    expect([...replacement.listeners.keys()]).toContain('render-process-gone')
  })

  it('does not stack listeners on a window it already watches', () => {
    const window = fakeWindow()
    const broker = brokerOver(() => window)
    broker.register()
    handlers.get(IPC.rendererReady)?.({ senderFrame: {} })
    // The FIRST send is what attaches, so count from after it.
    broker.send(command)
    let attached = 0
    const realOn = window.webContents.on
    window.webContents.on = (event: string, listener: (...args: unknown[]) => void) => {
      attached += 1
      realOn(event, listener)
    }

    broker.send(command)
    broker.send(command)
    broker.send(command)

    expect(attached).toBe(0)
  })
})
