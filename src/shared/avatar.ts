/**
 * The avatar vocabulary — emotions, visemes, the backend contract.
 *
 * Moved to `@hando/dough`: none of it is specific to this character or to this
 * application, and the engine cannot describe a face without it. Re-exported
 * here so the twelve modules that import `@shared/avatar` did not change.
 */
export * from '@hando/dough/core/vocabulary'
