import { apply as applyRetry, inject as retryInject } from './src/retry/index.js';

export const name = 'deshark-session-tree';
export const inject = retryInject;

/** Mount the Session Tree features in the current DSH profile. */
export function apply(ctx) {
  applyRetry(ctx);
}
