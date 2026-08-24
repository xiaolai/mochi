import type { WireTool } from '@shared/capability/registry'

/**
 * The tool list she is handed, written out so a person can read it.
 *
 * ## Why this exists
 *
 * The shelf's `Sent` tab answers *"what will she be told"* — and answered only
 * half of it. `whatSheMayDo` returns `{ instructions, tools }`, the tab drew
 * `instructions`, and the `tools` array was displayed nowhere at all. Those
 * `description` fields are the largest body of model-facing prose in the app
 * and every word of them is compiled in.
 *
 * That they are not editable is deliberate and argued: a description that
 * drifts from what the tool actually does makes her misreport the machine,
 * which is §11's measured failure — *"the model may invent a tool name or
 * pretend it completed the action"* — and `what-she-may-do.ts` refuses a
 * general "personas may edit manifests" hook for the same reason.
 *
 * **Not editable is a different claim from not visible, and the second does not
 * follow from the first.** Nobody can reason about why she did something
 * without seeing what she was given.
 *
 * ## Read from the wire value, never re-derived
 *
 * The input is `whatSheMayDo`'s own `tools` — already filtered by grant and
 * already narrowed per persona — so a withheld capability is absent here
 * exactly as it is absent on the wire, and `set_expression` shows the faces
 * this character actually has rather than all eight. Anything that rebuilt the
 * list to display it would be a second answer to a question with one.
 *
 * ## Prose, not JSON
 *
 * The wire carries JSON and a person reading "what is she told" is not
 * debugging a payload; they are reading sentences somebody wrote. The argument
 * names and the enum are kept because they are the part that constrains what
 * she can ask for — `set_expression`'s narrowed `face` enum is the single most
 * surprising thing on this screen, and it is invisible in prose alone.
 */
export function renderTools(tools: readonly WireTool[]): string {
  if (tools.length === 0) {
    // Not an empty box. Every capability withheld is a real state — the grants
    // panel can produce it — and a blank readout reads as a bug in the readout.
    return 'Nothing. Every capability is switched off, so she is offered no tools at all.'
  }
  return tools.map(describe).join('\n\n')
}

function describe(tool: WireTool): string {
  const lines = [`## ${tool.name}`, '', tool.description]
  const args = argumentLines(tool)
  if (args.length > 0) lines.push('', ...args)
  return lines.join('\n')
}

function argumentLines(tool: WireTool): readonly string[] {
  const properties = tool.parameters.properties
  const names = Object.keys(properties)
  if (names.length === 0) return []
  const required = new Set(tool.parameters.required ?? [])
  return names.map((name) => {
    const property = properties[name]
    const parts = [`- ${name}`]
    // Required is the half a reader acts on; optional is the absence of it.
    if (required.has(name)) parts.push('(required)')
    const description = property?.description ?? ''
    if (description !== '') parts.push(`— ${description}`)
    /*
      The enum, when there is one, because it is what she may actually say.

      `set_expression` is narrowed per character by `whatSheMayDo`, so this line
      is the only place the difference between "eight faces exist" and "this
      character has three" is visible to anybody.
    */
    const choices = property?.enum
    if (choices !== undefined && choices.length > 0) {
      parts.push(`[${choices.join(', ')}]`)
    }
    return parts.join(' ')
  })
}
