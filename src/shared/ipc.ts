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
  /** Delete conversations: some of hers, all of hers, or every one there is. */
  'history:forget',
  /** Everything that went wrong, for the window that can show it. */
  'history:problems',
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
   * The characters, what had to be resolved, and what she will be told.
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
  /**
   * Write the system prompt document.
   *
   * APP-LEVEL, unlike everything else on this list, and it is on the shelf's
   * channels rather than the settings window's because that is where it is
   * edited — the pane already shows what it produces, and putting the editor
   * and the receipt in two windows would be two places to reason about one
   * string. See `store/prompt.ts` for why it is a file the user owns.
   */
  'shelf:prompt',
  /**
   * Put one turn's words on the clipboard.
   *
   * Through main rather than through `navigator.clipboard`, which REFUSES an
   * unfocused document — `NotAllowedError: Document is not focused`, reproduced
   * here in two runs out of three against a window that had not won focus. In
   * practice a click focuses the window first and the browser path works; the
   * point is that it does not have to be true, and a copy button whose failure
   * depends on which window was frontmost is one nobody can diagnose.
   *
   * WRITE-ONLY, and deliberately not `clipboard:read`. Reading would let this
   * page take whatever a person had copied from somewhere else, which is a
   * different thing entirely from handing back words it is already displaying.
   */
  'shelf:copy',
  /**
   * Try one of her expressions on, from the grid that decides which she may use.
   *
   * ## Why the switches were not enough
   *
   * Eight faces are drawn and six of them are, in practice, unreachable: the
   * only things that change her expression are two built-in reactions in
   * `face.ts` — neutral when she sleeps, a perk when she wakes — and this
   * preview. `set_expression` was the route to the rest and was removed on
   * 2026-08-26, having been called zero times in 275 sessions.
   *
   * So this preview is not a convenience. It is the only way to see six of the
   * eight at the size she actually appears on the desktop, and the only thing
   * that makes the face grid mean anything at all.
   *
   * ## It is not gated on `faces`, and that is the point
   *
   * The grant and the character's `faces` constrain what SHE may reach for on
   * her own. A person clicking a tile in their own settings window is not her
   * reaching for anything, and requiring the face to be enabled first would
   * make it impossible to look at one before deciding to enable it — which is
   * the whole reason to click.
   *
   * Checked against `EMOTIONS` all the same: this ends at `wearExpression`,
   * which is one enum wide, and a window may not widen it.
   */
  'shelf:wear-face',
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
 * **One channel here takes a path, and it is the only one.** `settings:lookup`
 * carries `workspace`, which `SettingsLookup` documents as *"the one place a
 * path crosses this bridge... a deliberate exception rather than an
 * oversight"* — it is the value being displayed and edited, and somebody
 * choosing a directory has to see which one. `applyLookup` checks it in main:
 * a non-string is refused, and so is anything that is not absolute.
 *
 * Everything else names a location by KIND. `settings:reveal` takes a
 * `Revealable`, `settings:show-profile` takes no argument at all, and
 * `settings:choose-workspace` opens the panel IN MAIN and answers with what it
 * saved — a renderer that could hand main an arbitrary path to open would be a
 * file browser with the user's authority, reachable from a page.
 *
 * This paragraph read *"Nothing here takes a path"* until 2026-08-28, while
 * `settings:lookup` took one four hundred lines below. Both comments were
 * written deliberately and only one was true; the false one was the summary at
 * the head of the list, which is where a reader checks. `claims.test.ts` exists
 * for exactly this — a comment that claims a guard needs the test that proves
 * it, or it should not be in the source.
 */
export const SETTINGS_CHANNELS = [
  /** Everything the window draws: what she may do, lookups, folders. */
  'settings:read',
  /** Show me where these files are. A KIND, never a path. */
  'settings:reveal',
  /**
   * Open one of the project's three addresses in the browser.
   *
   * A KIND, never a URL, for `settings:reveal`'s reason and one that is sharper:
   * `shell.openExternal` opens whatever it is handed, `file://` included, so a
   * channel taking a string from the window is a channel that opens whatever
   * ends up in that window. `shared/links.ts` holds the three.
   */
  'settings:open-link',
  /**
   * Ask the release page whether there is a newer build.
   *
   * Three channels rather than one taking a verb, because they are three
   * different acts with three different costs: a request, a 120MB download, and
   * replacing the running application. A single channel would make them look
   * interchangeable to the next reader.
   */
  'settings:check-update',
  'settings:download-update',
  'settings:install-update',
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
  /**
   * Which languages she should expect to hear.
   *
   * Its own channel rather than a field on `settings:screen`, because that one
   * is about the corner of the display and this decides what her archive ends
   * up holding. Folding them together would put a control that changes what is
   * remembered on a pane somebody opens to move a speech bubble.
   */
  'settings:hearing',
  /**
   * Ask the machine about Codex again, and wait for the answer.
   *
   * `invoke`, not a fire-and-forget: the check spawns two child processes with
   * a deadline each, so it takes long enough that a button which returned
   * immediately would look like it had done nothing. The renderer disables the
   * control until this resolves and redraws from what comes back.
   *
   * It exists because three of the seven states are FIXED FROM OUTSIDE THIS
   * APP — install the CLI, sign in, wait for a busy machine to settle — and a
   * status that could only be refreshed by relaunching would send somebody
   * looking for the fix back to the one place the fix cannot be applied.
   */
  'settings:codex-recheck',
  /**
   * Rewrite one catalogued prompt, or reset it to what the app ships.
   *
   * Every string this app puts in front of a model is in that catalogue — the
   * tool descriptions, the guidance she is handed when something fails, the
   * framing on a workspace lookup, the note rewriter's instruction. All of it
   * was a literal in the module that used it, readable only in the source.
   *
   * `null` resets. It deletes the override rather than writing the default
   * back, so a prompt reset today keeps improving with the app instead of
   * freezing at this release's wording — see `store/prompts.ts`.
   */
  'settings:prompt',
  /**
   * Open the system folder panel, and save whatever is chosen as the workspace.
   *
   * The path is chosen IN MAIN, which is the whole reason this is a channel of
   * its own rather than a flag on `settings:lookup`. A picker that answered
   * with a path and let the page send it back would add a SECOND way for a
   * renderer to name a location, and the one that already exists —
   * `settings:lookup`'s `workspace` — is a deliberate exception argued for on
   * `SettingsLookup`, checked by `applyLookup`, and the only one. What crosses
   * here is a request with no argument at all, and the answer is what got
   * saved.
   *
   * This paragraph said "the list above promises that nothing here takes a
   * path" until 2026-08-28. The list said that and it was not true — see the
   * header — so this reasoned from a guarantee the file did not have. The
   * argument survives without it, and is stronger: the point is not to keep a
   * promise, it is not to add a second path-bearing channel.
   *
   * `history:export` sets the precedent and the reason is the same: a renderer
   * that named the destination would be a renderer able to reach anywhere with
   * this application's authority.
   *
   * It WRITES as well as asking, and that is deliberate. A picker that answered
   * with a path for the page to send through `settings:lookup` would be two
   * round trips with a window in between where the page could substitute a
   * different one — the panel would have become decoration over a free-text
   * field.
   */
  'settings:choose-workspace',
  /**
   * Show me the Codex profile file for the profile that is in force.
   *
   * NO ARGUMENT, which is what makes it safe: main already knows which profile
   * is set and where Codex keeps its files, so there is no name to check and no
   * path to refuse. A channel taking the profile name would be a channel that
   * has to prove the name cannot escape `$CODEX_HOME`.
   *
   * Separate from `settings:reveal` rather than a new `Revealable`. That list
   * is folders under `userData` resolved by `folderFor`, and this is a single
   * file in another application's directory whose name depends on a setting —
   * folding it in would make one function answer two unrelated questions.
   */
  'settings:show-profile',
  /**
   * Bind one global key, or give it back to what the app ships.
   *
   * ## `ok: false` here can mean "saved, and it does not work"
   *
   * Every other writer on this bridge answers `ok: true` when the write landed.
   * This one has a third outcome the others do not: the preference is stored
   * and the combination is refused by the operating system, because another
   * application already holds it.
   *
   * It is stored anyway — the other application may be quit later, and refusing
   * to save would mean a combination somebody wants can never be chosen while
   * something else happens to hold it. But it does not work RIGHT NOW, and
   * answering `ok: true` would put a green "Saved." over a dead key. So the
   * answer is `ok: false` with a sentence that says both halves, and the row
   * redraws underneath it carrying the same refusal.
   */
  'settings:key',
] as const

export type SettingsChannel = (typeof SETTINGS_CHANNELS)[number]

export function isSettingsChannel(value: unknown): value is SettingsChannel {
  return typeof value === 'string' && (SETTINGS_CHANNELS as readonly string[]).includes(value)
}

/**
 * When the ring over her head is drawn, and why `never` is one of the answers.
 *
 * Here rather than in `store/worn.ts` beside `BUBBLE_SIDES`, because unlike a
 * bubble side this crosses into HER window as well as into the settings one —
 * `showsHalo` in `face.ts` takes it — and a type main owns is a type the
 * renderer cannot import.
 *
 * - `always` — the open ring and the resting hairline. The default.
 * - `listening` — the open ring only, which is the state that means the
 *   microphone is live. The hairline is the one people find noisy.
 * - `never` — nothing on her at all.
 *
 * `never` is offerable because the promise moved. `halo.ts` exists so that an
 * open microphone is never silent on screen, and while the halo was the only
 * surface saying it, an off switch for the halo was an off switch for that. The
 * tray item marks itself while the microphone is open now: it cannot be hidden,
 * cannot be dragged off a display, and is the only way to quit the application.
 */
export const HALO_WHEN = ['always', 'listening', 'never'] as const
export type HaloWhen = (typeof HALO_WHEN)[number]

export function isHaloWhen(value: unknown): value is HaloWhen {
  return typeof value === 'string' && (HALO_WHEN as readonly string[]).includes(value)
}

/**
 * What she looks like on the desktop, as the settings window draws it.
 *
 * The bubble's SIDE used to live here. It is a persona field now — see
 * `Persona.bubbleSide` — because whether she shows words was already hers, and
 * splitting one feature across two tabs left a live side control on this pane
 * governing something a character with the bubble off could not display.
 */
export interface SettingsScreen {
  /**
   * When the halo over her head is drawn. See `HALO_WHEN`.
   *
   * It was `haloAtRest: boolean`, and deliberately narrower than "show the
   * halo": while the halo was the only surface saying the microphone was open,
   * a switch that could turn it off was a way to make the worst thing this app
   * can do happen. The tray marks itself while the microphone is live now, and
   * it cannot be hidden or switched off, so all three answers are ordinary
   * preferences. See `readHaloWhen`.
   */
  readonly halo: HaloWhen
  /** Every value the pane may offer, so it never draws one main would refuse. */
  readonly haloChoices: readonly HaloWhen[]
  /**
   * Whether the speech-bubble control appears at her shoulder on hover.
   *
   * Offerable as a plain switch, unlike the halo, because nothing is only
   * reachable through it: the bubble carries the same control and the tray menu
   * opens the same window. See `readShoulderChip`.
   */
  readonly shoulderChip: boolean
  /** Minutes of silence before she rests on her own. `0` is never. */
  readonly sleepAfterMinutes: number
  /** Every value the pane may offer, so it never draws one main would refuse. */
  readonly sleepAfterChoices: readonly number[]
}

/**
 * Which languages she should expect to hear, as the settings window draws it.
 *
 * The empty list is the ordinary state and the window says so in words rather
 * than leaving an empty control to be read as broken: nothing chosen means the
 * transcriber works the language out for itself, which is what it is good at.
 */
export interface SettingsHearing {
  /** ISO 639-1 codes currently hinted. Empty means detect. */
  readonly languages: readonly string[]
  /**
   * Every language the pane may offer, code and name.
   *
   * Sent rather than imported by the window, for `haloChoices`' reason: the
   * list main will accept and the list the pane draws have to be one list, and
   * two copies of it drift the day either is edited.
   */
  readonly choices: readonly { readonly code: string; readonly label: string }[]
  /** How many may be chosen at once, so the pane can say so before refusing. */
  readonly most: number
}

/** What may be changed about her hearing. Absent means unchanged. */
export interface HearingChange {
  /** Codes, unchecked — this is the WIRE shape. `applyHearing` decides. */
  readonly languages?: readonly unknown[]
}

/** What may be changed about the screen. Absent means unchanged. */
export interface ScreenChange {
  /** A `HaloWhen`, unchecked — this is the WIRE shape. `applyScreen` decides. */
  readonly halo?: string
  readonly shoulderChip?: boolean
  readonly sleepAfterMinutes?: number
}

/**
 * One global key, what it does, and whether this application actually got it.
 *
 * ## It was read-only, and the reason expired
 *
 * `plan-v2.md` recorded that not carrying v1's editable system over was
 * deliberate, and priced it: an accelerator parser, a conflict resolver, a
 * settings pane and a persisted map. Three of those four now exist for other
 * reasons — the pane is here, the store writes into `preferences.json` already,
 * and `applyKey` is the shape every other checked change on this bridge has.
 * What was left was the grammar, which is `shared/accelerator.ts`.
 *
 * `refused` predates all of it and stays: `globalShortcut.register` returns
 * false when another application owns the combination, and until that field
 * existed the failure reached only a log. It matters more now, not less — a
 * combination somebody has just chosen is far likelier to be taken than one
 * this project picked for being empty.
 */
export interface SettingsKey {
  readonly id: string
  /**
   * A short name for the row — "Talk to her".
   *
   * B5 draws a name over a sentence, and `what` was carrying both jobs: "Let her
   * rest, or wake her" is a description standing where a label goes, so a column
   * of two of them is two sentences somebody reads rather than two names they
   * scan. See `SHORTCUT_NAMES`.
   */
  readonly name: string
  readonly what: string
  readonly accelerator: string
  /** Null when this application has it. The reason, when it does not. */
  readonly refused: string | null
  /**
   * Whether somebody has chosen this one, rather than it being what ships.
   *
   * The pane reads this and nothing else about the default: a reset sends
   * `null`, which DELETES the stored answer, so the window never needs to know
   * the combination it goes back to. This carried a `shipped` field beside it
   * for exactly one commit, read by nothing — which is the defect
   * `nothing-written-goes-unread.test.ts` exists to catch, arriving in the
   * change that added the test.
   */
  readonly edited: boolean
}

/**
 * Bind one global key, or give it back to what the app ships.
 *
 * `null` RESETS, and it deletes the stored answer rather than writing today's
 * default into it — so a key reset now keeps tracking whatever later releases
 * ship, instead of freezing at this one while reporting itself unchanged. It is
 * `settings:prompt`'s rule, for the same reason `store/prompts.ts` gives.
 *
 * One key at a time, carrying which and what. `settings:grant`'s shape and its
 * reason: sending the whole table would let two windows write each other's
 * answers back.
 */
export interface KeyChange {
  readonly id: string
  /** An accelerator, unchecked — this is the WIRE shape. `applyKey` decides. */
  readonly accelerator: string | null
}

/** What this build is, and where the rest of it went. */
/**
 * Whether there is a newer build, as one of six answers.
 *
 * `unsupported` is not a failure: an unpackaged build has no `app-update.yml`
 * and nothing to verify a download against, and saying so is better than a red
 * error in a development window. `none` carries WHEN it was checked, because
 * "no update" with no date is a claim that ages badly and cannot be judged.
 */
export type SettingsUpdate =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'none'; readonly checkedAt: number }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'failed'; readonly why: string }

export interface SettingsAbout {
  readonly name: string
  readonly version: string
  readonly electron: string
  /**
   * Which processor this build was made for — `arm64`, `x64`.
   *
   * B7 draws it on the version line, and it is the fact a bug report needs that
   * the version number does not carry: the same version on the wrong
   * architecture runs under translation, and nothing else on screen says so.
   */
  readonly arch: string
  /**
   * `process.platform`, so the window can spell a key combination the way this
   * operating system spells it.
   *
   * A renderer guessing from a user-agent string is a renderer that gets it
   * wrong on one machine in twenty and cannot be told it did. See `keyGlyphs`.
   */
  readonly platform: string
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
  /**
   * Which side her words sit on, already resolved for the sheet to draw.
   *
   * Never null here, unlike the persona field: `sideFor` in main has already
   * decided what a character nobody has asked should show, so the control does
   * not need to know that "nobody has said" and "auto" are different answers.
   */
  readonly bubbleSide: string
  /**
   * Whether NEW conversations with this character are written down.
   *
   * Not on her manifest, and deliberately: it lives in the policy store, filed
   * under her id, so a package cannot arrive having decided that the person
   * installing it is never recorded. It rides the sheet because that is where
   * she is, not because it is one of her properties.
   */
  readonly keeps: boolean
  /** Every side that may be CHOSEN. From main, so the page holds no second list. */
  readonly bubbleSides: readonly string[]
  readonly avatarId: string | null
  /** Where she came from, or null for the built-in. Shown, never sent back. */
  readonly source: string | null
  /**
   * Her face, RESOLVED, so the card can draw her — or UNDEFINED when she named
   * one and it was not there.
   *
   * The artifact's cards are anchored by a small coloured mochi and this build
   * shipped four lines of text where that face should be — the strongest piece
   * of identity on the shelf, missing from the one screen that exists to tell
   * characters apart. Resolved here rather than in the renderer for the reason
   * `ShelfResolved` gives: where it actually landed, not where it was asked to
   * look.
   *
   * `| undefined` is the whole of contract C4 and it was missing for the life of
   * this field. `ResolvedAvatar.face` is documented "always valid — the built-in
   * when nothing else is", which is right for the companion, who must be drawn,
   * and wrong for the one list whose job is telling characters apart: every card
   * showed the same green mochi and the screen silently stopped working. Both
   * renderers already handled the absence -- `card.classList.add('faceless')`
   * and its dashed rule have existed all along -- and a non-optional type here
   * made that branch unreachable. A rule written into the view and then made
   * dead by a type is worse than one never written, because it reads as held.
   */
  readonly face: FaceSpec | undefined
  /** Which words this character takes, for the line under her name. */
  readonly pronoun: Pronoun
  /*
    The six the Cast pane draws controls for.

    On the CHARACTER rather than on `ShelfView.plates`, because that is what
    they are: `resolved` holds values that had to be found — where her face
    actually landed, which folder this machine lets her read — and these are
    stored fields, the same as `name` and `voice` above.
  */
  /** What she calls you. Empty is a real answer: nobody has said. */
  readonly addressUser: string
  /**
   * Which of the eight themes she wears, or null for a hue of her own.
   *
   * A `Persona.theme` may be a `CustomTheme` object — a hue nobody picked from
   * the swatches — and the grid cannot show one. Null rather than a nearest
   * match, so the pane can say she has a colour of her own instead of lighting
   * up a swatch that is not what is stored.
   */
  readonly theme: ThemeId | null
  /** Her own prompt — the character half of what she is told. */
  readonly style: string
  /** What she should convey on waking, and on going back to sleep. */
  readonly greeting: string
  readonly farewell: string
  /**
   * Which of the eight expressions this character may wear.
   *
   * ## It was taken off this wire, and it is back because it does something now
   *
   * The comment that stood here recorded why it went: no window read it, the
   * control that set it was gone, and nothing in this application consulted the
   * list to decide what she wears — so the switch changed one sentence in her
   * instructions and nothing else. `nothing-written-goes-unread.test.ts`
   * required the field to go with its reader, which was right.
   *
   * A2c gives it a reader. `companion/face.ts` asks `rules/expressions.ts` what
   * she may wear before the waking perk, so withholding `surprised` means she
   * wakes without it — the set decides what is on her face rather than only what
   * she is told about it. Contract C2 and C5 stop being moot in the same breath.
   *
   * The empty set is legal and has to survive: switch all eight off and she is
   * simply never told she has a face to change. `wearing` falls back to
   * `neutral` whether or not neutral is permitted, because withholding an
   * expression withholds a CHANGE, and a character with no face at all is not a
   * state anything downstream can draw.
   */
  readonly faces: readonly Emotion[]
  /** Her own answer about how big she is drawn, or null to accept her face's. */
  readonly size: number | null
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
 * `workspace` is a PATH, and it is the one a RENDERER MAY NAME. The direction is
 * the whole content of that claim and the wording used to omit it — "the one
 * place a path crosses this bridge", which is false in the other direction and
 * was flagged as such: `profilePath`, `folders`, `about.userData` and
 * `ChosenWorkspace.workspace` are all paths main sends out, because a person
 * cannot be shown where their files are without being told.
 *
 * Sent OUT is display; sent IN is authority. This is the only path a page may
 * put on the wire, and it is a deliberate exception rather than an oversight:
 * it is the value being displayed and edited, and somebody choosing a directory
 * has to see which one. It travels back through `settings:lookup`, where
 * `applyLookup` refuses a non-string and refuses anything not absolute — the
 * renderer naming a path is not the renderer choosing what may be read.
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
   * Whether anything is actually at `profilePath`.
   *
   * The pane said "Settings for it live in …" about a path with nothing at it,
   * which is a sentence that sends somebody looking for a file that was never
   * written — a profile name may be set for a file the user has yet to create.
   * It also decides whether there is anything to show: a button that reveals a
   * path with no file at it does nothing and looks broken.
   */
  readonly profileExists: boolean
  /**
   * What the local Codex is actually worth, in seven states rather than two.
   *
   * It was `codexFound: boolean`, which answers one of the three questions that
   * decide whether she can speak at all: is it installed, does it run, and is
   * its login usable BY US. The last is stricter than Codex's own answer — it
   * reports itself signed in while holding an expired access token, because it
   * owns a refresh token and renews on its next run, and this app cannot renew
   * because the JWT's `client_id` is Codex's. So "found" was true for a machine
   * whose credential was dead, and the failure arrived as a bare 401 at the
   * moment somebody spoke to her.
   *
   * `CodexReadiness` and nothing else from `main/codex/status.ts`: that type
   * carries a resolved binary path and the list of directories searched, and a
   * search path is a home directory, which is a username. `readinessOf` maps
   * one to the other with an exhaustive switch.
   */
  readonly codex: SettingsCodex
}

/**
 * What came back from the folder panel.
 *
 * `HistoryExport`'s three arms and for its reason: dismissing a panel is not a
 * failure and must not be reported as one. The window says nothing at all when
 * somebody changes their mind, which is the difference between a control that
 * feels like a control and one that scolds.
 *
 * The chosen path comes BACK rather than being left for the next read, so the
 * message can name what was saved. Main has already written it by then.
 */
export type ChosenWorkspace =
  | { readonly ok: true; readonly workspace: string }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly why: string }

/** How ready Codex is, and what a person does about it. Nothing else. */
export interface SettingsCodex {
  readonly readiness: CodexReadiness
  /** Keyed for `REMEDY_SAYS`, and null exactly when nothing is wrong. */
  readonly remedy: Remedy | null
  /**
   * What is installed, or null when there is nothing to report.
   *
   * The version and NOT the path. `CodexStatus` carries a resolved binary path
   * and the directories that were searched — a search path is a home directory,
   * which is a username — and none of that belongs on a wire the renderer reads.
   *
   * Null for `not-installed` and for a check that never came back, which is what
   * makes "older than the measurement was taken on" unanswerable rather than
   * false. See `CONFINEMENT_MEASURED_AGAINST`.
   */
  readonly version: string | null
  /**
   * When the check that produced this last finished, or null before the first
   * one does.
   *
   * On the wire because the answer is CACHED: `checkCodex` spawns two child
   * processes, so it runs at launch and when the button is pressed, and never
   * on a redraw. Everything above is therefore a claim about the machine as it
   * was at this instant, and a card that states it without saying when is
   * asking to be believed indefinitely. B1 draws the age; see `freshness.ts`.
   */
  readonly checkedAt: number | null
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
  /**
   * Where the file is, so A2b's apparatus column can say it.
   *
   * The same exception `SettingsLookup.workspace` names and for the same reason:
   * a path sent OUT is display, and somebody cannot be told where their own
   * notes are kept without being told. Nothing travels back on it.
   */
  readonly path: string
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
 * What may be deleted from the archive, and at which scope.
 *
 * ## `one` is absent on purpose
 *
 * Deleting one is `some` with a single token. One code path, one transaction,
 * one confirmation shape -- and it keeps the batch as the unit that commits,
 * which is the property a per-token loop quietly gives up.
 *
 * ## The id is a PRECONDITION, not an instruction
 *
 * Main deletes the WORN character's conversations, decided in main, exactly as
 * the note actions do. The id says which character the page was showing when
 * the button was pressed, and main refuses when the two disagree. Without it,
 * arming "delete all of hers" and having the tray switch character before the
 * second gesture deletes somebody else's archive, after a confirmation that
 * named the first.
 *
 * ## What this is not
 *
 * It is not a security boundary. The same bridge exposes `wear`, so a page that
 * had been taken over could simply become another character first. It bounds
 * ACCIDENTS -- a stale view, a switch in flight -- which is the failure that
 * actually happens. Anything stronger has to be enforced somewhere a renderer
 * cannot reach at all.
 */
export type ForgetTalk =
  | { readonly kind: 'some'; readonly id: string; readonly tokens: readonly string[] }
  | { readonly kind: 'hers'; readonly id: string }
  | { readonly kind: 'everything' }

/**
 * What came of it.
 *
 * `pending` is the honest half: the rows are gone, and the words may still be
 * in the write-ahead log because a reader held the checkpoint off. It clears
 * itself, but a UI that said "deleted" while that was outstanding would be
 * making a promise the disk has not kept yet.
 */
export interface Forgotten {
  readonly ok: boolean
  /**
   * How many conversations went, or null when that was not counted.
   *
   * Null for "all of hers" and "everything", and the type says so rather than
   * a comment: those delete by predicate in one statement, so a count would be
   * a second query run only to fill a field. It first returned `1` for them,
   * which was a number that would have been believed -- 1, after deleting four
   * hundred. A shape that cannot express the lie is better than a note asking
   * people not to tell it.
   */
  readonly gone: number | null
  readonly pending: boolean
  readonly why: string | null
}

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
/** One catalogued prompt, as the pane draws it. See `store/prompts.ts`. */
export interface SettingsPrompt {
  readonly key: string
  readonly title: string
  readonly purpose: string
  /** What is sent today — the override when there is one, the default otherwise. */
  readonly text: string
  readonly edited: boolean
  /**
   * Required phrases this override has dropped.
   *
   * Shown, never enforced. `askWorkspace.framing` carries the `sources`
   * contract `parseFields` checks, and the summariser names the fenced blocks
   * it is told to distrust — dropping one is very likely a mistake and is
   * occasionally exactly what somebody meant.
   */
  readonly missing: readonly string[]
  /**
   * The longest an override may be, or absent when nothing bounds it.
   *
   * ENFORCED, unlike `missing`, and sent for the reason `SettingsHearing.most`
   * is sent: the pane names the limit before a write is attempted rather than
   * letting somebody paste nine thousand characters and only then be refused.
   */
  readonly limit?: number
}

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
  readonly hearing: SettingsHearing
  /**
   * Every string this app puts in front of a model, and what it says today.
   *
   * The whole catalogue rather than the edited ones: a pane that listed only
   * overrides would answer "what have I changed" when the question somebody
   * opens it with is "what is she told".
   */
  readonly prompts: readonly SettingsPrompt[]
  readonly keys: readonly SettingsKey[]
  readonly about: SettingsAbout
  /** Whether there is a newer build. See `SettingsUpdate`. */
  readonly update: SettingsUpdate
  /** Named for display. Opening one goes through `settings:reveal` by kind. */
  readonly folders: Readonly<Record<Revealable, string>>
}

/** What may be changed about a persona from this window, and nothing else. */
export interface PersonaChange {
  readonly id: string
  readonly name?: string
  readonly voice?: string
  readonly bubble?: boolean
  /** A `BubbleSide`, unchecked — the WIRE shape. `applyChange` decides. */
  readonly bubbleSide?: string
  /**
   * Turn the recording of NEW conversations on or off for this character.
   *
   * Handled apart from the rest of a change: everything else here is written to
   * her manifest, and this is written to the policy store. The channel is
   * shared because the control is on the same sheet and a second one would be
   * two round trips for one switch.
   */
  readonly keeps?: boolean
  readonly avatarId?: string | null
  /*
    The six the Cast pane can now change, and could not before.

    Every one of them was a validated, persisted field with no control anywhere
    — settable only by hand-editing a manifest. `faces` is the sharpest: it
    narrows the tool enum on the wire and appears in her prompt, and it shipped
    with no way to set it.
  */
  readonly pronoun?: string
  readonly addressUser?: string
  readonly theme?: string
  readonly style?: string
  readonly greeting?: string
  readonly farewell?: string
  readonly faces?: readonly string[]
  /**
   * How big she is drawn, or null to go back to what her face declares.
   *
   * Null is a real answer here, not "unchanged" — `undefined` is unchanged.
   * Without the distinction there would be no way back to the face's own
   * number once somebody had disagreed with it once.
   */
  readonly size?: number | null
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
  hearing(change: HearingChange): Promise<SettingsWrite>
  /** Rewrite one catalogued prompt; `null` resets it. See `settings:prompt`. */
  prompt(key: string, text: string | null): Promise<SettingsWrite>
  grant(change: GrantChange): Promise<SettingsWrite>
  /**
   * Bind one global key; `null` gives it back to what the app ships.
   *
   * `ok: false` may mean the preference was stored and the combination refused
   * by the system. See `settings:key`.
   */
  key(change: KeyChange): Promise<SettingsWrite>
  reveal(what: Revealable): void
  /** Open the author's site, the repository or the website. See `Link`. */
  openLink(what: Link): void
  /** Look. Answers with what it found; nothing is fetched. */
  checkUpdate(): Promise<SettingsUpdate>
  /** Fetch it. Resolves when the download has landed, not when it starts. */
  downloadUpdate(): Promise<SettingsUpdate>
  /** Quit and install what was downloaded. Returns only if it declined to. */
  installUpdate(): void
  /**
   * Ask for the folder panel, and answer with what was saved.
   *
   * The renderer never names the folder. See `settings:choose-workspace`.
   */
  chooseWorkspace(): Promise<ChosenWorkspace>
  /** Show the Codex profile file. Main knows which one; there is no argument. */
  showProfile(): void
  /**
   * Ask the machine about Codex again. Answers with what it found.
   *
   * The one settings call that is not a WRITE, which is why it does not answer
   * `SettingsWrite`: nothing is saved, a machine is examined. Every remedy for
   * an unhappy Codex is applied outside this app, so without this the only way
   * to clear a stale status is to quit the application somebody was just told
   * to go and fix something for.
   */
  recheckCodex(): Promise<SettingsCodex>
}

/**
 * The prefix on every frame main sends the companion that the SERVICE must
 * never see.
 *
 * `voice:send` does two jobs. Most of what crosses it is the ledger's answers,
 * which belong on the data channel; the rest is main talking to the renderer —
 * the reconnect, the close, the problem count, asleep, her stance, the bubble's
 * side, the standing grants, whether a lookup is running, whether the halo is
 * drawn at rest. A channel per lifecycle event is the shape v1's 45 message
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
   * text is a person's words: whether it reaches disk is the saving setting's
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
      /**
       * What KIND of turn this was: `commentary`, `final_answer`, or null.
       *
       * §26 §5 and §67 §1 measured a tool turn arriving as two items — a
       * `message` tagged `commentary` and then the `function_call` — and §69
       * measured what that costs here: the commentary message is SPOKEN, so
       * *"let me take a moment to respond thoughtfully"* reaches the archive
       * looking exactly like an answer.
       *
       * Reported rather than acted on in the renderer. Whether a preamble is
       * part of the conversation is a decision about what she remembers, and
       * `heard.ts` states the rule those follow: decisions are main's.
       */
      readonly phase: string | null
      /**
       * When this turn belongs in the archive, in epoch milliseconds.
       *
       * A turn settles when its VERDICT arrives — `output_audio_buffer.stopped`
       * for one she finished, `conversation.item.truncated` for one she was cut
       * off in — and both can be seconds after the transcript, or an hour later
       * at session close. Stamping at the write would reorder the archive
       * against the conversation that produced it.
       */
      readonly at: number
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
  /**
   * Everything this session owed main has been sent. Nothing more is coming.
   *
   * ## Why the conversation cannot simply end when main says sleep
   *
   * Main puts her to rest by sending `__mochi_close__`. The renderer's shutdown
   * flushes a turn she was cut off in -- through `report`, which is
   * asynchronous. Main ending the conversation on the way out of `setAsleep`
   * therefore ends it BEFORE those turns arrive, and a late one begins a fresh
   * conversation behind her closed eyes: a live, empty session she is not awake
   * for, which is worse than the wrong `ended_at` this was meant to fix.
   *
   * ## Why it rides this channel and not its own
   *
   * Ordering. Both travel on `voice:report`, so a frame sent after the flush is
   * DELIVERED after the flush. A dedicated channel would race the very turns it
   * is acknowledging, and the race would be invisible in ordinary use -- it
   * needs an interrupted utterance and a sleep in the same instant.
   */
  | { readonly kind: 'flushed' }
  /** A lifecycle change worth a line in the log. */
  | { readonly kind: 'state'; readonly state: string }
  /** Anything else worth saying once. */
  | { readonly kind: 'note'; readonly text: string }

import type { CodexReadiness, Remedy } from './delegation'
import type { FaceSpec } from './avatar-spec'
import type { Emotion } from './avatar'
import type { Pronoun } from './pronoun'
import type { Link } from './links'
import type { ThemeId } from './theme'

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
   * Which of the eight expressions she may wear.
   *
   * Here as well as on `SettingsPersona`, because the RIG is what has to obey it
   * and the rig lives in the companion window, which never sees the settings
   * view. `face.ts` asks `rules/expressions.ts` before the waking perk — so
   * withholding `surprised` means she wakes without it, which is the whole of
   * what "the switch controls something" means.
   *
   * Empty is legal. `wearing` falls back to `neutral` whatever the set says.
   */
  readonly faces: readonly Emotion[]
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
  /**
   * How the USER's speech is turned into text, resolved in main.
   *
   * On the config rather than a constant in the renderer because the languages
   * are a setting somebody can change, and `voice:config` is read fresh on
   * every session — so a change lands on her next wake without a restart, the
   * same way a persona edit does.
   *
   * `languages` EMPTY means send no hint and let the model detect. The renderer
   * omits the field entirely rather than sending `[]`, because an empty list is
   * a claim about what will be spoken and the absence of one is not.
   */
  readonly transcription: {
    readonly model: string
    readonly languages: readonly string[]
  }
}

/**
 * The shape the preload bridge puts on `window.mochi`.
 *
 * It lives here rather than in `src/preload` because the renderer has to name
 * this type too, and the renderer's TypeScript project does not — and should
 * not — compile the preload. Shared is the only directory both sides build.
 */
export interface MochiApi {
  /**
   * Mint a session. Returns the token identifying it, or a sentence saying why
   * not.
   *
   * `session` is NOT the key and is worth nothing on its own -- the key stays
   * in main. It says WHICH negotiation is speaking, so that a second open
   * arriving mid-handshake cannot hand its credential to the first renderer.
   */
  open(): Promise<{ ok: true; session: string; model: string } | { ok: false; why: string }>
  /**
   * Exchange the offer. Main holds the key; the renderer never sees it.
   *
   * `session` is what `open` returned. A superseded one is refused rather than
   * silently answered against the newer session's credential.
   */
  sdp(
    offer: string,
    session: string,
  ): Promise<{ ok: true; answer: string } | { ok: false; why: string }>
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
    /**
     * Where she sits inside the window RIGHT NOW, before this pad is applied.
     *
     * This was `at` — her position on SCREEN, `window.screenX + offset`, read in
     * the renderer's own frame. That number is not reliable: a renderer's screen
     * coordinates are a cached rect that Chromium refreshes on notifications it
     * does not always receive for a frameless transparent window moved by
     * `setPosition`. It answered `0` for a window main had already placed at
     * 1957,1058 — so main computed her position as the pad's own offsets from
     * the origin of a window nobody had ever seen, and moved her there.
     *
     * An OFFSET instead, which the renderer knows for certain because it is the
     * layout it is drawing. Main pairs it with `getBounds()` read in the same
     * handler, so both halves come from one moment — which is the whole property
     * the screen reading was introduced to get, obtained from the side that
     * actually has it.
     */
    was: { left: number; top: number }
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
