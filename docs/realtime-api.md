# The Realtime API, and what Mochi does with it

What the OpenAI Realtime API offers, which parts this application actually
sends, and where the walls are. Written against the code in this repository —
every "Mochi uses" claim below can be checked with the file reference beside it,
and every "the service does" claim says whether it was measured or read.

**Dates matter here.** The wire constants were read on 2026-08-07
(`src/shared/realtime-wire.json`), and the field-acceptance results were sent to
the live service on 2026-08-16. OpenAI changes this surface. When something
disagrees with this page, the service is right and this page is stale.

---

## The shape of a session

```
 ~/.codex/auth.json                     the credential — a ChatGPT OAuth token
        │
        ▼
 POST /v1/realtime/client_secrets       mint an ephemeral key
        │
        ▼
 POST /v1/realtime/calls?model=…        SDP offer → answer, WebRTC established
        │
        ▼
 data channel "oai-events"              JSON events both ways, audio on the media track
```

`src/shared/realtime-wire.json` holds those three URLs and the channel name in
one place so a change to any of them is one edit rather than a search.

**There is no API-key path.** `src/main/voice/credential.ts` says so in its
header and means it: the only credential this application can use is the
subscription token the Codex CLI already holds. The bearer never leaves the main
process — the renderer receives a peer connection and, at most, frames.

### Models

`src/shared/realtime-model.ts`

| Model               | Note                                       |
| ------------------- | ------------------------------------------ |
| `gpt-realtime-2.1`  | **the default**                            |
| `gpt-realtime-2`    |                                            |
| `gpt-realtime-mini` | cheaper, and see the commentary note below |

All of them connect on a ChatGPT-subscription credential — measured 2026-08-16,
by connecting rather than by minting. **Minting proves nothing**: the mint
endpoint returned `HTTP 200` and a usable key for the model name
`definitely-not-a-model-xyzzy`. The connect is the gate; a bogus model comes back
`error / invalid_model` there.

---

## What Mochi sends

Three client events, out of the eleven the API defines.

| Event                      | Where                                 | Why                                                          |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `session.update`           | `renderer/companion/audio/session.ts` | who she is, how she listens, what she may call               |
| `response.create`          | same                                  | her greeting, and any turn she takes without being spoken to |
| `conversation.item.create` | same                                  | handing a tool result back into the live session             |

The `session.update` payload, exhaustively — this is the entire configuration
surface this application touches:

```jsonc
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "…",              // persona + her note about you + the rules
    "output_modalities": ["audio"],
    "audio": {
      "output": { "voice": "…" },     // locks after her first audio; see below
      "input": {
        "noise_reduction": { "type": "far_field" },
        "turn_detection": { "type": "semantic_vad" },
        "transcription": { … }        // omitted entirely when no languages are chosen
      }
    },
    "tools": [ … ],
    "tool_choice": "auto"
  }
}
```

`semantic_vad` and `far_field` are not defaults, they are a fix. On speakers
rather than headphones, her own voice comes back through the microphone and an
energy threshold reads it as somebody taking a turn. `semantic_vad` lets the
model decide what a turn _is_.

### What she reads

Eight kinds of server event, out of forty-six:

`session.created`, `session.updated`, `error`, `response.done`,
`response.output_item.added`, `response.output_audio_transcript.{delta,done}`,
`response.function_call_arguments.{delta,done}`,
`conversation.item.input_audio_transcription.completed`,
`conversation.item.truncated`, `output_audio_buffer.{started,stopped,cleared}`

Everything else on the wire is ignored. `src/shared/realtime/frames.ts` is the
only place a frame is turned into something this application believes.

### The defaults you get by not sending anything

From a real `session.created`, before any `session.update`:

```json
{
  "audio": {
    "input": {
      "transcription": null,
      "noise_reduction": null,
      "turn_detection": {
        "type": "server_vad",
        "threshold": 0.5,
        "silence_duration_ms": 500,
        "create_response": true,
        "interrupt_response": true
      }
    },
    "output": { "voice": "marin", "speed": 1 }
  },
  "truncation": "auto",
  "max_output_tokens": "inf",
  "tracing": null
}
```

Transcription off, noise reduction off, `server_vad`, and a voice that is not
hers. Configuration you do not send runs on somebody else's defaults, and those
are them.

---

## The walls

These are the ones that shape the application rather than annoy it.

### A session lasts at most an hour

3599 seconds, and the server states its own expiry on the first frame as
`session.expires_at`. **Reconnecting is the main path, not an error path** — a
companion that lives on your desktop outlives its own session many times a day.

What that costs: a new Realtime session starts with an empty context. Without
something to carry the conversation across, she would forget the morning an hour
into it. `voice/session-config.ts` sends a _resume_ brief on a reconnect and a
dated _background_ brief on a fresh wake, and getting those two the wrong way
round is worse than sending neither.

### The voice locks after her first audio

`session.update` cannot change it within a session. **Switching persona is
therefore a reconnect**, not an update — which is why the voice is on the session
config rather than something the settings pane can apply live.

### There are no phonemes, no visemes, no word timestamps

Searched across all forty-six server events: `phoneme` 0, `viseme` 0, `word_` 0.
Every `timestamp` hit is `expires_at`. The transcription guide says it plainly
for the ASR side too — no word-level timestamps, no speaker labels, no
confidence.

So her mouth is driven by an RMS envelope off the audio track. **That is not a
stopgap awaiting a better API** — this provider does not have the thing a better
implementation would need. Visemes would mean another provider or local forced
alignment.

### `idle_timeout_ms` is `server_vad` only

Measured by rejection on both model lines: `unknown_parameter` under
`semantic_vad`. So "she speaks first after a silence" via turn detection costs
`semantic_vad`, which is the fix for hearing herself on speakers. It is a swap,
not an addition. Mochi drives proactive speech from an app-side timer instead.

### The credential goes stale, and nothing here can refresh it

The stored `access_token` expires somewhere between 5 and 17 days, and **only
running `codex` yourself refreshes it**. A machine nobody has opened Codex on for
a fortnight has a credential that fails at the moment a session opens — as a bare
`401`, the least informative place to find out.

Mochi checks the token's own `exp` at startup rather than at her first word, and
distinguishes _logged out_ from _logged in, token stale_, because the file exists
and parses in both cases. The 401 branch stays anyway: a token can be revoked
while the claim it carries is still in the future, and only the service knows.

### Interruption is the server's, and the transcript can arrive late

On WebRTC the server truncates the turn on its own when you interrupt — the
client does not have to ask. Two consequences that cost real debugging:

- The transcript of what she was _heard_ saying is not retrievable. Every frame
  carries the same full text, which is not what came out of the speaker.
- `conversation.item.input_audio_transcription.completed` can arrive **after**
  the interruption that ended the turn.

### Rejected outright

| Field                            | Result                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `token_limits.post_instructions` | `unknown_parameter` on both lines — documented in OpenAI's cost guide, not on the wire        |
| `reasoning.effort`               | rejected on `gpt-realtime`, accepted on `gpt-realtime-2`                                      |
| Custom voices (`voice: { id }`)  | real, but gated on sales contact, ≤20 per org, and a consent recording. Treat as non-existent |

---

## Available, and deliberately not used

Not a backlog — each row is a decision with a cost.

| Interface                             | What it buys                                                               | What it costs                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `conversation.item.truncate`          | tells the model where she actually got to                                  | the server already truncates on WebRTC                            |
| `output[N].phase` = `commentary`      | splits "I'm looking" from "here it is", tagged so code can tell them apart | `gpt-realtime-2` line; `mini` does not emit it                    |
| `input_image` content block           | she could see the screen                                                   | pixels leave the machine — a product decision, not a backlog item |
| `audio.output.speed` (0.25–1.5)       | per-persona pace                                                           | playback rate only; speaking _style_ still comes from the prompt  |
| `truncation.retention_ratio`          | context and cost control on long sessions                                  | editing history busts the prompt cache                            |
| `tracing`, `include: [… logprobs]`    | observability, ASR confidence                                              | nothing needs it yet                                              |
| Sideband WebSocket (`?call_id=rtc_…`) | main could own `session.update` instead of the renderer                    | docs are thin on the WebRTC half; verify by running it            |

---

## Checking any of this yourself

The field probe is worth re-running whenever OpenAI ships. Send one
`session.update` per candidate field, each with its own `event_id`, and attribute
any `error` frame back through `error.event_id` — which is the _client_ event's
id. The top-level `event_id` on an error frame is the server event's, so
comparing against that can never match.

Anything not rejected inside a few seconds is accepted, and **accepted does not
mean it does what its name says.**
