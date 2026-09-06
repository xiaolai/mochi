/**
 * Moved to `@hando/dough`, where the class is `DoughAvatar` — the engine is
 * open and does not carry her name.
 *
 * ## Why this is a subclass rather than a re-export
 *
 * The engine defaults an unspecified face to `PLAIN`, a deliberately generic
 * body that is not her: shipping the reserved character as a library's default
 * would hand her out with the library. In THIS application the default is the
 * opposite — she is the character, so a caller who does not name a face means
 * her.
 *
 * Both are right, and they are different defaults, so the boundary between them
 * is where the translation belongs. Fourteen character tests caught the missing
 * translation the moment the extraction landed, which is the whole argument for
 * having kept them.
 */
import { DoughAvatar, type AvatarOptions } from '@hando/dough/canvas2d/avatar'
import { MOCHI } from '@shared/avatar-spec'

export * from '@hando/dough/canvas2d/avatar'

export class MochiAvatar extends DoughAvatar {
  constructor(ctx: CanvasRenderingContext2D, options: AvatarOptions) {
    // `?? MOCHI` rather than spreading her first: an explicit `face: undefined`
    // has to mean the default too, and `{ face: MOCHI, ...options }` would let
    // it through as undefined and fall back to the engine's PLAIN instead.
    super(ctx, { ...options, face: options.face ?? MOCHI })
  }
}
