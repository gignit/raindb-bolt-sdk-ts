// bindings/catalog.ts -- STUBBED ctx.catalog.* surface.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface CatalogInsertInput {
  formationId: string;
  path: string;
  scopeValue: string;
  metadata?: Record<string, unknown>;
}

export interface CatalogInsertResult {
  entryId: string;
}

export interface CatalogDeleteInput {
  formationId: string;
  path: string;
  scopeValue: string;
}

export interface CatalogUpdateInput {
  formationId: string;
  path: string;
  scopeValue: string;
  metadata: Record<string, unknown>;
}

export interface CatalogTransferInput {
  formationId: string;
  fromPath: string;
  toPath: string;
  scopeValue: string;
}

export interface CatalogListInput {
  formationId: string;
  path: string;
  opts?: { pageSize?: number; cursor?: string };
}

export interface CatalogListEntry {
  scopeValue: string;
  metadata?: Record<string, unknown>;
  ts: string;
}

export interface CatalogListResult {
  entries: CatalogListEntry[];
  nextCursor?: string | null;
}

export interface CatalogTreeNode {
  path: string;
  entries: CatalogListEntry[];
  children?: CatalogTreeNode[];
}

export interface CatalogTreeInput {
  formationId: string;
  rootPath?: string;
  opts?: { depth?: number };
}

/**
 * Bolt-facing shape of `ctx.catalog` -- raw goja surface (STUB).
 */
export interface CatalogBinding {
  insert?: (input: CatalogInsertInput) => Promise<CatalogInsertResult>;
  delete?: (input: CatalogDeleteInput) => Promise<void>;
  update?: (input: CatalogUpdateInput) => Promise<void>;
  transfer?: (input: CatalogTransferInput) => Promise<void>;
  list?: (input: CatalogListInput) => Promise<CatalogListResult>;
  tree?: (input: CatalogTreeInput) => Promise<CatalogTreeNode>;
}

/**
 * STUB (audit §P Gap 11; CONTRACT-UNCERTAIN per handoff §C).
 *
 * Hierarchical tag catalog surface. Cross-validation: shapes match
 * @raindb/agent's `catalog_*` tools.
 */
export const catalog = {
  /**
   * STUB. Add an entry to a catalog node.
   * @throws BindingNotInstalled
   */
  async insert(input: CatalogInsertInput): Promise<CatalogInsertResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<CatalogInsertResult>(
      BINDING.catalog_insert,
      () =>
        (ctx as unknown as { catalog?: CatalogBinding }).catalog?.insert,
      (fn) =>
        (
          fn as (i: CatalogInsertInput) => Promise<CatalogInsertResult>
        )(input),
      input,
    );
  },

  /**
   * STUB. List entries at a catalog node.
   * @throws BindingNotInstalled
   */
  async list(input: CatalogListInput): Promise<CatalogListResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<CatalogListResult>(
      BINDING.catalog_list,
      () =>
        (ctx as unknown as { catalog?: CatalogBinding }).catalog?.list,
      (fn) =>
        (fn as (i: CatalogListInput) => Promise<CatalogListResult>)(input),
      input,
    );
  },

  /**
   * STUB. Walk the catalog hierarchy.
   * @throws BindingNotInstalled
   */
  async tree(input: CatalogTreeInput): Promise<CatalogTreeNode> {
    const ctx = resolveCtx();
    return stubOrDispatch<CatalogTreeNode>(
      BINDING.catalog_tree,
      () =>
        (ctx as unknown as { catalog?: CatalogBinding }).catalog?.tree,
      (fn) =>
        (fn as (i: CatalogTreeInput) => Promise<CatalogTreeNode>)(input),
      input,
    );
  },

  // TODO(substrate-card-P): confirm v1 scope -- the audit suggests
  // `insert/list/tree` may be sufficient. The next three are stubbed
  // for completeness; they may be removed in a future minor if the
  // requirements card resolves to "drop these".

  /**
   * STUB. Delete a catalog entry.
   *
   * TODO(substrate-card-P): confirm whether this verb ships in v1.
   * @throws BindingNotInstalled
   */
  async delete(input: CatalogDeleteInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.catalog_delete,
      () =>
        (ctx as unknown as { catalog?: CatalogBinding }).catalog?.delete,
      (fn) =>
        (fn as (i: CatalogDeleteInput) => Promise<void>)(input),
      input,
    );
  },

  /**
   * STUB. Mutate a catalog entry's metadata.
   *
   * TODO(substrate-card-P): confirm whether this verb ships in v1.
   * @throws BindingNotInstalled
   */
  async update(input: CatalogUpdateInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.catalog_update,
      () =>
        (ctx as unknown as { catalog?: CatalogBinding }).catalog?.update,
      (fn) =>
        (fn as (i: CatalogUpdateInput) => Promise<void>)(input),
      input,
    );
  },

  /**
   * STUB. Move an entry between catalog nodes.
   *
   * TODO(substrate-card-P): confirm whether this verb ships in v1.
   * @throws BindingNotInstalled
   */
  async transfer(input: CatalogTransferInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.catalog_transfer,
      () =>
        (ctx as unknown as { catalog?: CatalogBinding }).catalog?.transfer,
      (fn) =>
        (fn as (i: CatalogTransferInput) => Promise<void>)(input),
      input,
    );
  },
};
