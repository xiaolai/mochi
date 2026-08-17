/**
 * Path2D, in Node.
 *
 * The rig builds its silhouette as a Path2D because that is the only object a
 * canvas will both fill and hit-test against — which is what makes "only what
 * you can see takes the mouse" a property of one array rather than of two
 * pieces of geometry agreeing. In a browser Path2D is global; under Node it
 * ships with the rasteriser, so the tests install it here.
 *
 * A setup file rather than a per-test assignment: the rig imports Path2D at
 * module scope, and Vitest hoists imports above statements in the test body.
 */

import { Path2D as NodePath2D } from '@napi-rs/canvas'

globalThis.Path2D ??= NodePath2D as unknown as typeof globalThis.Path2D
