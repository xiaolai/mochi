/**
 * The one place a channel crossing the main↔renderer boundary is written down.
 *
 * Everything arriving from the renderer is untrusted input. It runs web content,
 * and whatever the preload bridge can reach, a compromised page can reach too.
 * So the channels are an allowlist checked at runtime, not a naming convention:
 * `isCompanionChannel` is what the bridge calls before it forwards anything.
 *
 * One channel is deliberately the whole contract right now. It exists to prove
 * the path is wired, and the v2 surface should grow this list rather than open a
 * second one somewhere else, so there stays exactly one thing to audit.
 */
export const COMPANION_CHANNELS = ['companion:ping'] as const

export type CompanionChannel = (typeof COMPANION_CHANNELS)[number]

export function isCompanionChannel(value: unknown): value is CompanionChannel {
  return typeof value === 'string' && (COMPANION_CHANNELS as readonly string[]).includes(value)
}

/**
 * The shape the preload bridge puts on `window.mochi`.
 *
 * It lives here rather than in `src/preload` because the renderer has to name
 * this type too, and the renderer's TypeScript project does not — and should
 * not — compile the preload. Shared is the only directory both sides build.
 */
export interface MochiApi {
  invoke(channel: CompanionChannel): Promise<unknown>
}
