// bindings/ids.ts -- typed wrapper for ctx.ids.uuidv7.

import { resolveCtx } from '../runtime/ctx-resolver.js';

/**
 * Bolt-facing shape of `ctx.ids`. Stateless ID helpers.
 */
export interface IdsBinding {
  uuidv7(): string;
}

/**
 * Stateless ID generator surface.
 *
 * @example
 * ```ts
 * const dropletId = ids.uuidv7();
 * ```
 */
export const ids = {
  /**
   * Generate a fresh UUIDv7 (time-sortable; the substrate's
   * canonical droplet identifier shape).
   *
   * LIVE binding. Synchronous; no error path.
   */
  uuidv7(): string {
    const ctx = resolveCtx();
    return ctx.ids.uuidv7();
  },
};
