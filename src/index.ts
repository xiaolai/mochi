/**
 * A soft-body companion character engine.
 *
 * The shape is a superellipse ovoid with independent exponents above and below
 * its widest point; it squashes area-preservingly, leans by a shear pinned at
 * its contact point, breathes on a one-sided curve and settles on a
 * second-order spring. A face rides on it at a configurable grip, so it deforms
 * with the body without being printed on it.
 *
 * Everything in `core` is pure arithmetic returning points and numbers. Nothing
 * there imports a canvas, a document, or a platform. `canvas2d` turns those
 * points into fills on any 2D context — a browser canvas, an OffscreenCanvas in
 * a worker, or `@napi-rs/canvas` under Node. `svg` emits the same silhouette as
 * a vector, so an icon pipeline and the running app cannot disagree about the
 * shape.
 *
 * A face is DATA — see `FaceSpec` — so a design is a JSON file rather than a
 * fork. `PLAIN` is the default; it is intended to be replaced.
 */

// --- core: the character as arithmetic -------------------------------------
export * from './core/spec.js'
export * from './core/plain.js'
export * from './core/vocabulary.js'
export * from './core/layout.js'
export * from './core/geometry.js'
export * from './core/lens.js'
export * from './core/looks.js'
export * from './core/idle.js'
export * from './core/spring.js'
export * from './core/motion.js'
export * from './core/envelope.js'
export * from './core/mouth.js'
export * from './core/colour.js'

// --- canvas2d: points into pixels ------------------------------------------
export * from './canvas2d/avatar.js'
export * from './canvas2d/face.js'
export * from './canvas2d/paths.js'

// --- svg: the same silhouette, as a vector ---------------------------------
export * from './svg/silhouette.js'

// --- characters: NOT MIT. See LICENSE.md ------------------------------------
export * from './characters/index.js'
