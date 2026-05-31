// bindings/tags.ts -- STUBBED ctx.tags.* surface.
// Audit §L (Gap 7).
//
// Note: the audit and the @raindb/agent's `entity_tag` tool diverge on
// the tag shape -- the audit proposes `string[]` (tag set), while
// agent's entity_tag uses `Record<string, string>` (tag map). We
// follow the audit's proposed shape since it's the substrate-side
// canonical (Go `Client.TagEntity(ctx, formationID, scopeValue, tags
// []string)`). When the substrate ships, if the goja side standardizes
// on a different shape, the package bumps minor version.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface TagInput {
  formationId: string;
  scopeValue: string;
  tags: string[];
}

/**
 * Bolt-facing shape of `ctx.tags` -- raw goja surface (STUB).
 */
export interface TagsBinding {
  tag?: (input: TagInput) => Promise<void>;
  untag?: (input: TagInput) => Promise<void>;
  replaceTags?: (input: TagInput) => Promise<void>;
}

/**
 * STUB (audit §L Gap 7). Per-entity tag set. Tags survive across
 * revisions and are used by the vector index for filtering and by
 * the periscope tier for tag-aware indexes.
 */
export const tags = {
  /**
   * STUB. Add tags to an entity (additive).
   * @throws BindingNotInstalled
   */
  async tag(
    formationId: string,
    scopeValue: string,
    tagList: string[],
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.tags_tag,
      () =>
        (ctx as unknown as { tags?: TagsBinding }).tags?.tag,
      (fn) =>
        (fn as (i: TagInput) => Promise<void>)({
          formationId,
          scopeValue,
          tags: tagList,
        }),
      { formationId, scopeValue, count: tagList.length },
    );
  },

  /**
   * STUB. Remove specified tags from an entity.
   * @throws BindingNotInstalled
   */
  async untag(
    formationId: string,
    scopeValue: string,
    tagList: string[],
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.tags_untag,
      () =>
        (ctx as unknown as { tags?: TagsBinding }).tags?.untag,
      (fn) =>
        (fn as (i: TagInput) => Promise<void>)({
          formationId,
          scopeValue,
          tags: tagList,
        }),
      { formationId, scopeValue, count: tagList.length },
    );
  },

  /**
   * STUB. Replace the entity's full tag set.
   * @throws BindingNotInstalled
   */
  async replaceTags(
    formationId: string,
    scopeValue: string,
    tagList: string[],
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.tags_replaceTags,
      () =>
        (ctx as unknown as { tags?: TagsBinding }).tags?.replaceTags,
      (fn) =>
        (fn as (i: TagInput) => Promise<void>)({
          formationId,
          scopeValue,
          tags: tagList,
        }),
      { formationId, scopeValue, count: tagList.length },
    );
  },
};
