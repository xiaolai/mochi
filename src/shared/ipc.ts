/**
 * The one place a channel crossing the main↔renderer boundary is written down.
 *
 * Everything arriving from the renderer is untrusted input. It runs web content,
 * and whatever the preload bridge can reach, a compromised page can reach too.
 * So the channels are an allowlist checked at runtime, not a naming convention:
 * `isCompanionChannel` is what the bridge calls before it forwards anything.
 *
 * ## One channel for every capability, not one per capability
 *
 * v1 had 45 message kinds, three of which were a per-tool triple —
 * `workspaceAsked`, `recallAsked`, and one for remembering. Adding a capability
 * meant adding to this contract, which is half of why adding one touched four
 * files. `voice:call` carries the name, so the contract stops growing when the
 * capability set does.
 */
export const COMPANION_CHANNELS = [
  /** Renderer asks main to mint. The bearer never crosses; a short-lived key may. */
  'voice:open',
  /** Renderer hands main an SDP offer; main exchanges it and returns the answer. */
  'voice:sdp',
  /**
   * Renderer asks for everything that goes in `session.update` — who she is,
   * what she sounds like, what she may call.
   *
   * ONE call rather than three, because all of it is main's to know: the
   * persona lives in main's store, the note lives beside it, and the capability
   * registry is main's by design. A renderer that assembled this would need the
   * persona, which is the same mistake as letting it decide which capability
   * runs.
   */
  'voice:config',
  /** She called a capability. Name, call id, raw arguments — main dispatches. */
  'voice:call',
  /** Renderer reports what the session is doing — see `VoiceReport`. */
  'voice:report',
  /** Main → renderer: put this frame on the data channel. */
  'voice:send',
  /** She was asked for her conversations. Main owns the window; this opens it. */
  'history:open',
  /**
   * Somebody clicked her while she was asleep.
   *
   * Waking has to be a gesture she cannot miss, and the obvious one — saying
   * "wake up" — is exactly what she cannot hear while the microphone is off.
   * So it is a click on her, the menu bar, or the key.
   */
  'companion:wake',
  /**
   * Which sides the bubble could go on right now, and which it is using.
   *
   * Sent when the answer CHANGES, not every frame. The menu is built from it,
   * and a menu that offers a side which cannot be honoured is the one thing
   * this must not produce — so the list comes from the same function that does
   * the placing rather than from a second guess about it.
   */
  'companion:sides',
  /**
   * Where she is INSIDE her window, in CSS pixels.
   *
   * Sent when it changes — a different avatar, a different size — because main
   * cannot work it out. The window is far larger than she is and the drag
   * clamps HER to the display rather than the window, so without this main
   * would either park her inland or let her walk off the edge.
   */
  'companion:body',
  /**
   * Renderer asks for a window that fits what it is about to draw.
   *
   * Her window is a shape on the desktop, not a rectangle she sits in, so it has
   * no business being larger than the thing drawn in it. The renderer is the
   * only side that knows what that is — where the chip went, whether a bubble is
   * up and on which side — so it asks, and main holds her screen position across
   * the change.
   */
  'companion:fit',
  /**
   * She was grabbed — the pointer went down on her painted pixels.
   *
   * Carries WHERE on her she was grabbed, so she does not jump on the first
   * tick. Main does the moving from there, polling the cursor: while dragging a
   * frameless window the pointer routinely leaves the window's bounds and the
   * renderer stops hearing about it, at which point she sticks to the edge.
   */
  'companion:grab',
  /** Let go. Main also has a deadline, for the mouseup that never arrives. */
  'companion:drop',
  /**
   * Right-clicked on her painted pixels. Main pops the menu.
   *
   * Main, not the renderer, because the menu is a real `NSMenu` — the system
   * draws it, navigates it and dismisses it. A menu drawn on her canvas would
   * be a second implementation of something the platform already does better,
   * and it would have to be kept in step with the menu bar item's.
   */
  'companion:menu',
  /**
   * Put her words on the clipboard.
   *
   * Main, not the renderer: the clipboard is a system surface, and this is the
   * process that owns system surfaces. It also means the text crossing is
   * whatever the renderer already has on screen rather than a new read.
   */
  'clipboard:write',
] as const

export type CompanionChannel = (typeof COMPANION_CHANNELS)[number]

/**
 * What the SHELF may ask for — a separate list, not an addition.
 *
 * Two documents, two allowlists, and neither can reach the other's channels.
 * A single list would mean the window showing a transcript could also mint a
 * key and exchange an SDP offer, and the companion could read any conversation
 * — for no better reason than that both are renderers.
 *
 * ## This window grew, and the rule it kept moved with it
 *
 * It used to be read-only, and this note used to say that the window showing a
 * person's words must never be able to change the persona those words are filed
 * under. That was the right rule for a transcript viewer and is the wrong one
 * for the shelf: characters and their conversations are one subject — deleting
 * a character takes her conversations with her — and splitting them across two
 * windows would put two ways to change one thing in two places, which is what
 * `menuHandlers` already exists to avoid.
 *
 * So the per-character half MOVED here rather than being copied: `settings:wear`,
 * `settings:save`, `settings:persona` and `settings:memory` are gone from the
 * settings allowlist below rather than duplicated into this one.
 *
 * ## What did NOT move: no transcript channel names a persona
 *
 * `history:list`, `history:turns`, `history:search` and `history:export` still
 * read whoever is worn, decided in main. That is the property worth keeping —
 * a compromised page can ask for the worn character's conversations and
 * nobody else's — and it survives a card being clickable, because clicking a
 * card WEARS somebody rather than naming them to a query.
 */
export const SHELF_CHANNELS = [
  /** Her conversations, newest first. */
  'history:list',
  /** What was said in one of them, by its opaque token. */
  'history:turns',
  /** Full-text search across hers. */
  'history:search',
  /** Everything that went wrong, for the window that can show it. */
  'history:problems',
  /**
   * Open the settings window.
   *
   * The way in lives HERE rather than on her bubble, which has exactly three
   * controls and a person asked for exactly those three. Opening a window is
   * also the only thing this channel does — the conversations window gets no
   * ability to read or write a setting by having it.
   */
  'history:settings',
  /**
   * Write everything she has for the worn persona to a file the person chooses.
   *
   * Here rather than in the settings window because this is about her
   * CONVERSATIONS, and this is the window that holds them. The path is chosen
   * in main through the system save panel — the page names no location, the
   * same rule `settings:reveal` follows.
   */
  'history:export',
  /**
   * The characters, the open one's four plates, and what she will be told.
   *
   * ONE call rather than a channel per plate, for the reason `settings:read`
   * gives: all of it is main's to know and all of it is read fresh, so a window
   * assembling it piecemeal would be the second place a character lives.
   */
  'shelf:read',
  /** Wear this character. The id is checked against the catalog in main. */
  'shelf:wear',
  /** Change fields on a character. Main decides what may be written and where. */
  'shelf:save',
  /** Make one, copy one, remove one, or put the built-in back. */
  'shelf:persona',
  /** Undo or clear what she remembers about the person. Per character. */
  'shelf:memory',
] as const

export type ShelfChannel = (typeof SHELF_CHANNELS)[number]

/**
 * What the settings window may ask for — a THIRD list, for the same reason
 * there is a second.
 *
 * What is left here once the shelf has taken the per-character half: the
 * standing grants, how a lookup runs, and where the app's own folders are.
 * `plan-shell.md` settles the split — a row belongs here when it is true of
 * this machine whoever is worn.
 *
 * The companion can mint a credential and must never be able to rewrite a
 * permission; this window can rewrite a permission and must never be able to
 * mint anything.
 *
 * **Nothing here takes a path.** `settings:reveal` names a folder by kind, not
 * by location — a renderer that could hand main an arbitrary path to open would
 * be a file browser with the user's authority, reachable from a page.
 */
export const SETTINGS_CHANNELS = [
  /** Everything the window draws: what she may do, lookups, folders. */
  'settings:read',
  /** Show me where these files are. A KIND, never a path. */
  'settings:reveal',
  /**
   * Change how a lookup runs — the workspace, web search, the Codex profile.
   *
   * ONE channel carrying a partial rather than three carrying a value each.
   * This contract already grew once for exactly that reason: v1 had 45 message
   * kinds, three of which were a per-tool triple, and adding a capability meant
   * adding to the contract. A settings surface that adds a channel per setting
   * is the same shape with a different subject.
   */
  'settings:lookup',
  /**
   * What she looks like on the desktop — today, which side the bubble sits on.
   *
   * The tray offers the same choice, and that is deliberate rather than
   * duplicated: `tray.ts` carries v1's standing rule that the tray is ACTIONS
   * and the window is CONFIGURATION. Both go through one handler in main, which
   * is what stops the two drifting.
   */
  'settings:screen',
  /**
   * Allow her something, or take it away — 5b's four standing grants.
   *
   * ONE grant at a time, carrying which and whether. The window sends the one
   * switch that moved rather than the whole set, so two windows open at once
   * cannot write each other's answers back.
   */
  'settings:grant',
] as const

export type SettingsChannel = (typeof SETTINGS_CHANNELS)[number]

export function isSettingsChannel(value: unknown): value is SettingsChannel {
  return typeof value === 'string' && (SETTINGS_CHANNELS as readonly string[]).includes(value)
}

/**
 * What she looks like on the desktop, as the settings window draws it.
 *
 * `sides` is every side that can be CHOSEN, which is not the same as every side
 * the bubble can currently reach — that shrinks as she is dragged into a corner
 * and is the renderer's answer, not main's. A window offering only what fits
 * right now would change its own options when somebody moved her.
 */
export interface SettingsScreen {
  readonly bubbleSide: string
  readonly sides: readonly string[]
}

/** What may be changed about the screen. Absent means unchanged. */
export interface ScreenChange {
  readonly bubbleSide?: string
}

/**
 * One global key, and whether this application actually got it.
 *
 * Read-only: the keys are two constants (`shared/shortcuts.ts`), and an
 * editable system is a second feature that `plan-v2.md` records as deliberately
 * not carried over. What the window adds is the half that was invisible —
 * `globalShortcut.register` returns false when another application owns the
 * combination, and until now that failure only reached a log and the problems
 * strip.
 */
export interface SettingsKey {
  readonly id: string
  readonly what: string
  readonly accelerator: string
  /** Null when this application has it. The reason, when it does not. */
  readonly refused: string | null
}

/** What this build is, and where the rest of it went. */
export interface SettingsAbout {
  readonly name: string
  readonly version: string
  readonly electron: string
  /** Where userData lives. Shown because every path below is under it. */
  readonly userData: string
}

/**
 * The folders a person may be shown. Named, so no path crosses the bridge.
 *
 * `capabilities` was here until capabilities moved into the source. Revealing
 * it would have offered a "Show" button that CREATES a folder this build no
 * longer loads anything from — pointing somebody at a place to put work that
 * would then be ignored, which is the failure `capability/legacy.ts` exists to
 * warn about rather than to cause. (That module still LOOKS in the folder, once
 * at startup, precisely so it can say so.)
 */
export const REVEALABLE = ['avatars', 'personas'] as const
export type Revealable = (typeof REVEALABLE)[number]

/** One character, as the shelf lists her. `ShelfCharacter` is this type. */
export interface SettingsPersona {
  readonly id: string
  readonly name: string
  readonly voice: string
  readonly bubble: boolean
  readonly avatarId: string | null
  /** Where she came from, or null for the built-in. Shown, never sent back. */
  readonly source: string | null
  /**
   * Her face, RESOLVED, so the card can draw her.
   *
   * The artifact's cards are anchored by a small coloured mochi and this build
   * shipped four lines of text where that face should be — the strongest piece
   * of identity on the shelf, missing from the one screen that exists to tell
   * characters apart. Resolved here rather than in the renderer for the reason
   * `plates.face` gives: where it actually landed, not where it was asked to
   * look.
   */
  readonly face: FaceSpec
  /** Which words this character takes, for the line under her name. */
  readonly pronoun: Pronoun
}

/**
 * One avatar somebody could wear.
 *
 * `id` is **null for the built-in**, because that is what a persona actually
 * stores: `avatarId: null` means the shipped face. Inventing a name for it here
 * would create a second way to say the same thing, and the resolver would have
 * to learn the fake one.
 */
export interface SettingsAvatar {
  readonly id: string | null
  readonly builtIn: boolean
}

/**
 * One capability, as the settings window lists it.
 *
 * A name and a description, and nothing else. This carried `state` and `why`
 * for something found in the user's capabilities folder that the build would
 * not run and would not describe to her — two fields whose only other value has
 * been deleted along with the folder that produced it. Everything listed here
 * is something she can actually call, so the fields said nothing and the
 * window had a branch that could not be reached.
 */
export interface SettingsCapability {
  readonly name: string
  readonly description: string
}

/**
 * How a lookup runs, as the settings window shows it.
 *
 * `workspace` is a PATH, and it is the one place a path crosses this bridge.
 * That is a deliberate exception rather than an oversight: it is the value being
 * displayed and edited, and somebody choosing a directory has to see which one.
 * It travels back through `settings:lookup`, where main checks it — the renderer
 * naming a path is not the renderer choosing what may be read.
 */
export interface SettingsLookup {
  readonly workspace: string
  /** True when nobody has chosen, so the window can say it is the default. */
  readonly workspaceIsDefault: boolean
  readonly webSearch: string
  /** Every value Codex accepts, plus `follow`. See `WEB_SEARCH_MODES`. */
  readonly webSearchModes: readonly string[]
  /** The Codex profile in force, or null for none. */
  readonly profile: string | null
  /** Where that file is, so somebody can go and edit it. Null when none. */
  readonly profilePath: string | null
  /**
   * Whether the Codex CLI was found at all.
   *
   * Without it she cannot look anything up, and the failure otherwise presents
   * as her declining to help. It is on this view so the group carrying the
   * lookup settings can mark itself as needing attention rather than showing
   * three controls for something that cannot run.
   */
  readonly codexFound: boolean
}

/**
 * What she remembers, and whether there is a version to go back to.
 *
 * `previous` is `null` when nothing has ever been rewritten, and that is NOT the
 * same as an empty string: a persona whose memory was blank when the first
 * rewrite ran has a previous note, and it is `''`. Collapsing the two would make
 * that first rewrite the one that cannot be undone — which is exactly the
 * rewrite somebody most wants back.
 */
export interface SettingsNote {
  readonly text: string
  readonly previous: string | null
}

/**
 * What may be done to the note. Both are undoable; neither deletes the file.
 *
 * It NAMES the character it was shown for, and that is the whole reason the id
 * is here — it is not used to choose whose note is written. Main writes the
 * WORN one, as everything else on this bridge does, and refuses when the two
 * disagree. Without it, clicking "Forget everything" while a character switch
 * was still in flight cleared the note of whoever had just been worn, while the
 * page was still showing somebody else's.
 */
export type NoteAction =
  | { readonly kind: 'restore'; readonly id: string }
  | { readonly kind: 'clear'; readonly id: string }

/**
 * What may be done to the shelf of personas.
 *
 * `create` and `duplicate` both take a NAME rather than an id: the id is derived
 * from the name in main, against the ids already taken and the ones a pending
 * deletion still reserves. A page choosing an id would be a page able to choose
 * whose memory and whose conversations a new character inherits.
 */
export type PersonaAction =
  | { readonly kind: 'create'; readonly name: string }
  | { readonly kind: 'duplicate'; readonly name: string }
  | { readonly kind: 'delete'; readonly id: string }
  /** Undo every edit to the built-in. Her original prompt is in the source. */
  | { readonly kind: 'restore-built-in' }

/** What may be changed about a lookup. Absent means unchanged. */
export interface LookupChange {
  readonly workspace?: string
  readonly webSearch?: string
  readonly profile?: string | null
}
/**
 * Everything the settings window draws, answered in one call.
 *
 * Only what is true regardless of character. The personas, the voices, the
 * avatars and the note went to the shelf with the controls that edit them —
 * see `ShelfView` and `plan-shell.md`'s split.
 */
export interface SettingsView {
  /**
   * The worn face, resolved — so the window can take HER colour.
   *
   * The design's second semantic rule: *the accent is her*, derived from
   * `colBody`, with no second place to set an app colour. The whole spec is
   * sent rather than five pre-computed variables because `accent.ts` is the one
   * derivation and it belongs in the renderer beside the sheet it fills in;
   * main computing them would be a second place the rule lives.
   */
  readonly face: FaceSpec
  /**
   * Which words this interface uses for the worn character.
   *
   * Sent rather than assumed, which is the whole reason `Persona.pronoun`
   * exists: `persona.test.ts` says in so many words that switching character has
   * to switch it too. It was validated, stored, migrated and tested for the
   * length of this build and never rendered -- so `he` and `it` were both
   * accepted and both still came out "her".
   */
  readonly pronoun: Pronoun
  readonly capabilities: readonly SettingsCapability[]
  /** The four standing grants, in the order `GRANT_SPECS` declares them. */
  readonly grants: readonly SettingsGrant[]
  readonly lookup: SettingsLookup
  readonly screen: SettingsScreen
  readonly keys: readonly SettingsKey[]
  readonly about: SettingsAbout
  /** Named for display. Opening one goes through `settings:reveal` by kind. */
  readonly folders: Readonly<Record<Revealable, string>>
}

/** What may be changed about a persona from this window, and nothing else. */
export interface PersonaChange {
  readonly id: string
  readonly name?: string
  readonly voice?: string
  readonly bubble?: boolean
  readonly avatarId?: string | null
}

/**
 * When a grant's capability was last called.
 *
 * A union rather than `number | null`, because there are THREE answers and two
 * of them are not the same: nothing records use for the microphone, and that
 * has to read differently from a capability that exists and has never been
 * used. 5b's acceptance is that the column is real or the row does not claim
 * it, and a `null` doing both jobs is exactly the claim it must not make.
 */
export type GrantUse =
  /** Recorded, and it has never been called. */
  | { readonly kind: 'never' }
  /** Recorded, and this is when. Epoch milliseconds. */
  | { readonly kind: 'at'; readonly at: number }
  /** Nothing records use for this one, so the row says so instead of "never". */
  | { readonly kind: 'not-recorded' }

/** One grant, as the settings window draws it. */
export interface SettingsGrant {
  /** A `Grant` from `@shared/grants`. */
  readonly id: string
  readonly allowed: boolean
  readonly lastUsed: GrantUse
}

/** Turning one grant on or off. */
export interface GrantChange {
  readonly id: string
  readonly allowed: boolean
}

/** Whether a write landed, and what to say when it did not. */
export type SettingsWrite = { readonly ok: true } | { readonly ok: false; readonly why: string }

export interface MochiSettingsApi {
  read(): Promise<SettingsView>
  lookup(change: LookupChange): Promise<SettingsWrite>
  screen(change: ScreenChange): Promise<SettingsWrite>
  grant(change: GrantChange): Promise<SettingsWrite>
  reveal(what: Revealable): void
}

/**
 * The prefix on every frame main sends the companion that the SERVICE must
 * never see.
 *
 * `voice:send` does two jobs. Most of what crosses it is the ledger's answers,
 * which belong on the data channel; the rest is main talking to the renderer —
 * the reconnect, the problem count, asleep, her stance, the bubble's side, the
 * standing grants. A channel per lifecycle event is the shape v1's 45 message
 * kinds grew out of, so they share one and are told apart by this.
 *
 * It is load-bearing rather than cosmetic. The renderer forwards what arrives
 * on that channel to the peer, and until this existed it forwarded ALL of it —
 * so every private frame was also written out to OpenAI, including the one
 * carrying her whole assembled prompt and her tool list. A stray unknown event
 * the service shrugs at is a nuisance; that one is a leak.
 *
 * Here rather than in either process, because both ends have to agree: main
 * chooses the names and the renderer decides what reaches the wire.
 */
export const PRIVATE_FRAME_PREFIX = '__mochi_'

/** Whether a frame is main talking to the renderer rather than to the service. */
export function isPrivateFrame(frame: unknown): boolean {
  const type = (frame as { type?: unknown } | null)?.type
  return typeof type === 'string' && type.startsWith(PRIVATE_FRAME_PREFIX)
}

export function isCompanionChannel(value: unknown): value is CompanionChannel {
  return typeof value === 'string' && (COMPANION_CHANNELS as readonly string[]).includes(value)
}

export function isShelfChannel(value: unknown): value is ShelfChannel {
  return typeof value === 'string' && (SHELF_CHANNELS as readonly string[]).includes(value)
}

/**
 * What the renderer tells main about the live session.
 *
 * A typed union on ONE channel rather than a channel each. The expiry is the
 * one that has to travel: `expires_at` arrives on `session.created`, which only
 * the renderer sees, and main is where the reconnect is scheduled (§53).
 */
export type VoiceReport =
  /** `session.created` announced the deadline. Absolute Unix **seconds**. */
  | { readonly kind: 'expiry'; readonly expiresAt: number }
  /**
   * What the user said, as ASR settled it.
   *
   * Structured rather than folded into a log line, because main files it. The
   * text is a person's words: whether it reaches disk is the retention setting's
   * decision, made in main, and the renderer neither knows it nor should.
   */
  | { readonly kind: 'heard'; readonly transcript: string }
  /**
   * What she said — with what is known about how much of it she was HEARD
   * saying.
   *
   * `heard` is null when she finished naturally: everything generated was
   * spoken, so there is nothing to cut. When she was interrupted it carries the
   * renderer's OBSERVATIONS and nothing more — where the cursor had reached,
   * and when the barge-in happened. Main does the cutting, because what is
   * remembered is a decision and decisions are main's.
   *
   * §58 measured the cost of not doing this: **~80–82% of an interrupted turn**
   * filed as though she had spoken it, and §55 counted 38 truncations in an
   * hour of ordinary use.
   */
  | {
      readonly kind: 'said'
      readonly transcript: string
      readonly heard: { readonly at: number; readonly interruptedAt: number } | null
    }
  /**
   * Whether the cursor is inside her silhouette right now.
   *
   * Sent only when it CHANGES, not every frame. Main owns the window, so main
   * is the only thing that can turn click-through on and off — and the renderer
   * is the only thing that knows the shape, because the shape is one `Path2D`
   * the rig both fills and hit-tests.
   */
  | { readonly kind: 'pointer'; readonly onHer: boolean }
  /** A lifecycle change worth a line in the log. */
  | { readonly kind: 'state'; readonly state: string }
  /** Anything else worth saying once. */
  | { readonly kind: 'note'; readonly text: string }

import type { FaceSpec } from './avatar-spec'
import type { Pronoun } from './pronoun'

/** What `session.update` is built from. Assembled in main; sent by the renderer. */
export interface SessionConfig {
  /** Who she is: persona, her note about the user, the rules. Never empty. */
  readonly instructions: string
  /** Locked after her first audio output — switching personas needs a reconnect (§21). */
  readonly voice: string
  readonly tools: readonly unknown[]
  /**
   * Whether she shows her words beside her.
   *
   * Per persona and off by default — a bubble is words over somebody's desktop,
   * and a companion that subtitles itself by default has decided for them.
   */
  readonly bubble: boolean
  /**
   * What to say on waking, as an instruction rather than as words — or **null**
   * when she may not speak first.
   *
   * A separate `response.create` rather than part of the system prompt, because
   * she must speak **without having been spoken to** — there is no user turn to
   * respond to, and a system prompt only shapes an answer to something.
   *
   * Null rather than an empty string, because "say nothing" is a decision main
   * made from a grant and an empty instruction is a prompt that says nothing.
   * The renderer branches on it, so the turn is never requested at all.
   */
  readonly greeting: string | null
  /**
   * Whether the microphone may open at all — 5b's first grant.
   *
   * On the config for the same reason `asleep` is: it is read from the same
   * file at the same moment, and a second message would arrive after she had
   * already started transmitting. It is NOT the same thing as `asleep`, which
   * is where she was left; this is what she is permitted, and the microphone
   * opens only when both agree.
   */
  readonly microphone: boolean
  /**
   * How she looks — the whole `FaceSpec`, resolved in main.
   *
   * Data, not a path. The renderer never reads the avatars folder: the format
   * is deliberately non-executable and bounded, and it is validated once, in
   * main, by `parseFaceSpec`. A renderer that loaded files would be a second
   * reader of user content in the process with the least authority.
   */
  readonly face: FaceSpec
  /**
   * How many things went wrong while assembling all this.
   *
   * A COUNT on the config rather than a channel of its own: the problems worth
   * showing all happen while resolving who she is and what she looks like, so
   * they are all known by the time this is answered. The companion needs only
   * enough to mark the control that opens the window where they are readable.
   */
  readonly problems: number
  /**
   * Which side of her the bubble was last asked to sit on.
   *
   * On the config because it is read from the same file as the worn persona and
   * is wanted at the same moment — the alternative is a second message that
   * arrives after the first frame has already been drawn on the wrong side.
   */
  readonly bubbleSide: string
  /**
   * Whether she is asleep — the microphone closed and her eyes shut.
   *
   * On the config for the same reason as the bubble's side: it is read from the
   * same file at the same moment, and a second message would arrive after she
   * had already opened the microphone.
   */
  readonly asleep: boolean
}

/**
 * The shape the preload bridge puts on `window.mochi`.
 *
 * It lives here rather than in `src/preload` because the renderer has to name
 * this type too, and the renderer's TypeScript project does not — and should
 * not — compile the preload. Shared is the only directory both sides build.
 */
export interface MochiApi {
  /** Mint a session. Returns a short-lived key, or a sentence saying why not. */
  open(): Promise<{ ok: true; key: string; model: string } | { ok: false; why: string }>
  /** Exchange the offer. Main holds the key; the renderer never sees it again. */
  sdp(offer: string): Promise<{ ok: true; answer: string } | { ok: false; why: string }>
  /** Everything `session.update` needs. See `voice:config`. */
  config(): Promise<SessionConfig>
  /** Forward a tool call to main. Fire and forget: the answer comes back as a frame. */
  call(name: string, callId: string, args: string): void
  /** Open the conversations window. Main owns every window, so main opens it. */
  history(): void
  /** Copy her words. There is no selecting text in a canvas. */
  copy(text: string): void
  /** Ask for the context menu, at the cursor. */
  menu(): void
  /** She was clicked while asleep. Main decides whether that wakes her. */
  wake(): void
  /** Where she is inside her window, so main can keep HER on the display. */
  body(box: { left: number; top: number; width: number; height: number }): void
  /** Ask for a window that fits what is about to be drawn. See the channel. */
  fit(request: {
    pad: { left: number; top: number; right: number; bottom: number }
    body: { left: number; top: number; width: number; height: number }
  }): void
  /** Which sides the bubble can go on, and which it is on. For the menu. */
  sides(available: readonly string[], using: string): void
  /** Start moving her. `offsetX/Y` is where on her the pointer went down. */
  grab(offsetX: number, offsetY: number): void
  drop(): void
  /** Tell main what the session is doing. */
  report(event: VoiceReport): void
  /**
   * Frames main wants put on the data channel — the ledger's answers.
   *
   * Returns the way to STOP listening, and that is not decoration: a session is
   * opened on every wake and again on every reconnect (§53: hourly), and each
   * one subscribed. Without this, every session ever opened stayed reachable
   * for the life of the window, holding its peer, its channel and its callbacks.
   */
  onSend(handle: (frame: unknown) => void): () => void
}

/** One conversation, as the window lists it. */
export interface HistoryConversation {
  /** Opaque; holding it authorises nothing. Every read still checks the persona. */
  readonly token: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly turns: number
}

/** One thing said in one. */
export interface HistoryTurn {
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
  /**
   * She was cut off partway through this one.
   *
   * Carried because the window is the only place a reader can see it, and
   * without it an interrupted turn is indistinguishable from a short one — the
   * text was silently shortened and nothing says so. An empty text with `cut`
   * is a turn she began and was cut off in before a word survived.
   */
  readonly cut: boolean
}

/** One search result, with the conversation it came from so it can be opened. */
export interface HistoryHit {
  readonly token: string
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
}

/**
 * What the conversations window gets on `window.mochiHistory`.
 *
 * A different global from `window.mochi` rather than more methods on it: the
 * two documents load the same preload file, and a single object would mean the
 * companion page could call `turns()` because the bridge had already built it.
 * The role decides which one is installed, so the other is not merely
 * unreachable — it was never constructed.
 */
/** One thing that went wrong, as the window lists it. */
export interface HistoryProblem {
  readonly area: string
  readonly subject: string | null
  readonly detail: string
  readonly at: number
}

/**
 * What came of an export.
 *
 * `cancelled` is a first-class answer rather than a failure: somebody who
 * dismissed the save panel has not hit an error and should not be told they
 * have. `path` comes back so the window can say where it went — "exported" with
 * no location is a message somebody then has to go hunting after.
 */
export type HistoryExport =
  | { readonly ok: true; readonly path: string; readonly conversations: number }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly why: string }

/**
 * One character, as the shelf lists her.
 *
 * The same fields `SettingsPersona` carried, because it is the same list — it
 * moved rather than being copied. The type keeps its name so the settings
 * module's `listPersonas` did not have to grow a second shape for one caller.
 */
export type ShelfCharacter = SettingsPersona

/**
 * The four plates 1a raises over the open character.
 *
 * Three of them are `Persona` fields. The fourth is not, and saying so is the
 * point: `workspace` is app-level (`plan-shell.md`'s split), so this plate is a
 * READOUT that points at settings rather than a control pretending to be
 * per-character. Drawing four plates and quietly making one of them global
 * would be worse than drawing three.
 */
export interface ShelfPlates {
  /** Which avatar file she wears, and where it actually resolved to. */
  readonly face: { readonly avatarId: string | null; readonly source: string | null }
  readonly voice: string
  /** Her own prompt — `Persona.style`, the character half of what she is told. */
  readonly prompt: string
  /** App-level, and the plate says so. See above. */
  readonly workspace: string
}

/** Everything the shelf's character half draws, answered in one call. */
/**
 * Her state, for the strip across the top of the shelf.
 *
 * The handoff is blunt about why this is there and why it is first: *"a
 * microphone that is open with nothing saying so is the worst thing a desktop
 * companion can do."* So it is not decoration and it is not a status bar — it
 * is the one surface that always answers whether she is listening.
 */
export interface ShelfState {
  readonly asleep: boolean
  /** Whether the microphone grant allows one at all. See `@shared/grants`. */
  readonly microphone: boolean
  /** The key that wakes her, or null when another application took it. */
  readonly restKey: string | null
}

export interface ShelfView {
  /** The worn face, resolved. See `SettingsView.face` — same rule, same reason. */
  readonly face: FaceSpec
  readonly state: ShelfState
  readonly wornId: string
  readonly characters: readonly ShelfCharacter[]
  readonly avatars: readonly SettingsAvatar[]
  readonly voices: readonly string[]
  /**
   * Which words this interface uses for the worn character.
   *
   * Sent rather than assumed, which is the whole reason `Persona.pronoun`
   * exists: `persona.test.ts` says in so many words that switching character has
   * to switch it too. It was validated, stored, migrated and tested for the
   * length of this build and never rendered -- so `he` and `it` were both
   * accepted and both still came out "her".
   */
  readonly pronoun: Pronoun
  readonly plates: ShelfPlates
  /**
   * Exactly what she will be told on the next wake.
   *
   * `instructionsFor`'s output, with the withheld-grants notice on the end —
   * the real string, not a summary of it. 1b's right-hand card is literally
   * that function's output, and a card that re-assembled it here would be the
   * second place her prompt is built.
   */
  readonly assembled: string
  readonly note: SettingsNote
}

export interface MochiHistoryApi {
  /** Everything that went wrong this launch, newest first. */
  problems(): Promise<readonly HistoryProblem[]>
  /** Save everything to a file. Answers what happened, for a status line. */
  exportAll(): Promise<HistoryExport>
  /** Open the settings window. Opening it is all this can do. */
  settings(): void
  /** Whoever is worn. The window never gets to name a persona. */
  list(): Promise<{
    readonly persona: string
    readonly conversations: readonly HistoryConversation[]
  }>
  turns(token: string): Promise<readonly HistoryTurn[]>
  search(query: string): Promise<readonly HistoryHit[]>
  /** The characters, the open one's plates, and what she will be told. */
  shelf(): Promise<ShelfView>
  /** Wear somebody. Checked against the catalog in main. */
  wear(id: string): Promise<SettingsWrite>
  /** Change a field on a character. Main decides what may be written, and where. */
  saveCharacter(change: PersonaChange): Promise<SettingsWrite>
  /** Make one, copy one, remove one, or put the built-in back. */
  character(action: PersonaAction): Promise<SettingsWrite>
  /** Undo the last change to her note, or clear it. */
  memory(action: NoteAction): Promise<SettingsWrite>
}
