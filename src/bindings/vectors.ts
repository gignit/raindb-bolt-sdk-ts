// bindings/vectors.ts -- STUBBED ctx.vectors.* surface.
//
// CONTRACT-UNCERTAIN per handoff §C: the embedding vector parameter
// shape (Float32Array vs number[]) is not yet decided on the goja
// side. We type as `number[]` for v0.1; when the substrate-side
// requirements card lands (audit §N), the type may tighten to
// Float32Array. Bolts that use number[] today continue to work
// after the swap (Float32Array would be additive).
//
// TODO(substrate-card-N): tighten the vector parameter shape.
// Audit §N (Gap 9).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface VectorQueryInput {
  formationId: string;
  /** Embedding vector. Float32Array support TBD per handoff §C. */
  vector: number[];
  opts?: VectorQueryOpts;
}

export interface VectorQueryOpts {
  limit?: number;
  minSimilarity?: number;
  /** Tag-narrowed scope filter. */
  tags?: string[];
}

export interface VectorQueryByTextInput {
  formationId: string;
  text: string;
  opts?: VectorQueryOpts;
}

export interface VectorHit {
  scopeValue: string;
  similarity: number;
  fieldName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Bolt-facing shape of `ctx.vectors` -- raw goja surface (STUB).
 */
export interface VectorsBinding {
  query?: (input: VectorQueryInput) => Promise<VectorHit[]>;
  queryByText?: (input: VectorQueryByTextInput) => Promise<VectorHit[]>;
  deleteFormation?: (formationId: string) => Promise<void>;
}

/**
 * STUB (audit §N Gap 9; CONTRACT-UNCERTAIN per handoff §C).
 *
 * Semantic search over substrate-managed embeddings. Formations
 * declaring `VectorFieldMeta` opt in to embedding generation.
 *
 * Cross-validation: read shape matches @raindb/agent's `vector_search`
 * tool's `VectorSearchHit` projection (key/score/text/metadata).
 */
export const vectors = {
  /**
   * STUB. Vector similarity search with caller-supplied embedding.
   * @throws BindingNotInstalled
   */
  async query(input: VectorQueryInput): Promise<VectorHit[]> {
    const ctx = resolveCtx();
    return stubOrDispatch<VectorHit[]>(
      BINDING.vectors_query,
      () =>
        (ctx as unknown as { vectors?: VectorsBinding }).vectors?.query,
      (fn) =>
        (fn as (i: VectorQueryInput) => Promise<VectorHit[]>)(input),
      { formationId: input.formationId, dim: input.vector.length },
    );
  },

  /**
   * STUB. Vector search where the substrate first embeds `text`
   * via the platform LLM router, then queries.
   * @throws BindingNotInstalled
   * @throws RainDBBoltError when LLM router not configured for tenant
   */
  async queryByText(
    input: VectorQueryByTextInput,
  ): Promise<VectorHit[]> {
    const ctx = resolveCtx();
    return stubOrDispatch<VectorHit[]>(
      BINDING.vectors_queryByText,
      () =>
        (ctx as unknown as { vectors?: VectorsBinding }).vectors
          ?.queryByText,
      (fn) =>
        (
          fn as (i: VectorQueryByTextInput) => Promise<VectorHit[]>
        )(input),
      { formationId: input.formationId, textLen: input.text.length },
    );
  },

  /**
   * STUB. Purge all embeddings for a formation. Rare; admin-class
   * but exposed because the bolt's tenant owns the data.
   * @throws BindingNotInstalled
   */
  async deleteFormation(formationId: string): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.vectors_deleteFormation,
      () =>
        (ctx as unknown as { vectors?: VectorsBinding }).vectors
          ?.deleteFormation,
      (fn) =>
        (fn as (id: string) => Promise<void>)(formationId),
      { formationId },
    );
  },
};
