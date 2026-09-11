// bindings/tags.ts -- ergonomic ctx.tags.* surface.

import { db, type TagInput, type UntagInput } from './db.js';
import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

/**
 * Bolt-facing shape of `ctx.tags` -- the goja sandbox does NOT
 * install a `ctx.tags` namespace today (Wave 2 Tier 2 routed tag
 * mutations through `ctx.db.tag` / `ctx.db.untag` instead). This
 * type stays optional on BoltContext so older bolts that import
 * the namespace type compile; runtime calls route through `db.*`.
 */
export interface TagsBinding {
  /**
   * STUB ONLY -- no substrate binding ships under `ctx.tags`.
   * The SDK wrapper routes through `ctx.db.tag` instead. This
   * field exists for type-import backwards compatibility.
   */
  replaceTags?: (input: { formationId: string; scopeValue: string; tags: Record<string, string> }) => Promise<void>;
}

/**
 * Re-export of the canonical TagInput shape from `db.ts`. Kept
 * here so `import { tags, TagInput } from '@raindb/bolt-sdk'`
 * continues to compile on consumers that already use the type.
 */
export type { TagInput, UntagInput };

/**
 * Input shape for {@link tags.replaceTags} (STUB).
 */
export interface ReplaceTagsInput {
  formationId: string;
  scopeValue: string;
  tags: Record<string, string>;
}

/**
 * The `tags` namespace -- ergonomic three-arg wrappers over the
 * `db.tag` / `db.untag` named-args API.
 *
 * - {@link tag} and {@link untag} are LIVE (route through db.* which
 *   route through `ctx.db.tag` / `ctx.db.untag`).
 * - {@link replaceTags} stays STUBBED -- the substrate does not
 *   ship a native atomic replace. Bolts that don't need atomicity
 *   can emulate via `await db.untag(...)` then `await db.tag(...)`.
 *
 * @example
 * ```ts
 * import { tags } from '@raindb/bolt-sdk';
 * await tags.tag('agent-graph', 'a-018f...', { env: 'prod', tier: 'gold' });
 * await tags.untag('agent-graph', 'a-018f...', ['tier']);
 * ```
 */
export const tags = {
  /**
   * Add tag key=value pairs to an entity (additive).
   *
   * LIVE since v0.3.0 (routes through `db.tag`, which routes
   * through the substrate's `ctx.db.tag`).
   *
   * @requires capability: `tag` on the formation
   * @throws CapabilityDenied
   * @throws BindingNotInstalled on runtime without the binding
   */
  async tag(
    formationId: string,
    scopeValue: string,
    tags: Record<string, string>,
  ): Promise<void> {
    const input: TagInput = { formationId, scopeValue, tags };
    await db.tag(input);
  },

  /**
   * Remove tag KEYS from an entity. Idempotent.
   *
   * LIVE since v0.3.0 (routes through `db.untag`, which routes
   * through the substrate's `ctx.db.untag`).
   *
   * @requires capability: `tag` on the formation
   * @throws CapabilityDenied
   * @throws BindingNotInstalled on runtime without the binding
   */
  async untag(
    formationId: string,
    scopeValue: string,
    tagKeys: string[],
  ): Promise<void> {
    const input: UntagInput = { formationId, scopeValue, tagKeys };
    await db.untag(input);
  },

  /**
   * STUB (audit §L Gap 7). The substrate did not ship a native
   * atomic replaceTags binding -- the SDK exposes TagEntity
   * (additive) and UntagEntity (key-removal) only. For
   * non-atomic replace, emulate client-side:
   *
   * ```ts
   * // 1. read the entity's current tags somehow (the bolt knows them)
   * // 2. untag the keys you no longer want
   * await db.untag({ formationId, scopeValue, tagKeys: oldKeysToRemove });
   * // 3. tag the new set (overwrites any keys you re-supply)
   * await db.tag({ formationId, scopeValue, tags: newTagSet });
   * ```
   *
   * @throws BindingNotInstalled when substrate does not (and
   *   currently does not) ship a native replace binding
   */
  async replaceTags(
    formationId: string,
    scopeValue: string,
    tags: Record<string, string>,
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.tags_replaceTags,
      () =>
        (ctx as unknown as { tags?: TagsBinding }).tags?.replaceTags,
      (fn) =>
        (fn as (i: ReplaceTagsInput) => Promise<void>)({
          formationId,
          scopeValue,
          tags,
        }),
      { formationId, scopeValue, count: Object.keys(tags).length },
    );
  },
};
