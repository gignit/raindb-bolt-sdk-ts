// bindings/token.ts -- STUBBED ctx.token.* surface.
//
// Per audit §V token+stats handoff doc and HANDOFF_RAINDB_TOKEN_BINDINGS.md.
// Five methods: write, claim, read, delete, deleteAll. The substrate-
// side agent is shipping these as v0.4 of the lightning runtime; the
// package's stubs throw BindingNotInstalled until the swap.
//
// Cross-validation: shapes follow the substrate Go SDK
// `Client.WriteToken/ClaimToken/ReadToken/DeleteToken/DeleteAllTokens`
// in `pkg/sdk/token.go`.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';
import type { Token, WriteTokenOptions } from '../types/token.js';

export interface WriteTokenInput {
  formationId: string;
  scopeValue: string;
  options: WriteTokenOptions;
}

export interface ClaimTokenInput {
  formationId: string;
  scopeValue: string;
  options: Omit<WriteTokenOptions, 'createOnly'>;
}

export interface ReadTokenInput {
  formationId: string;
  scopeValue: string;
}

export interface DeleteTokenInput {
  formationId: string;
  scopeValue: string;
}

export interface DeleteAllTokensInput {
  formationId: string;
}

/**
 * Bolt-facing shape of `ctx.token` -- raw goja surface (STUB until
 * substrate ships v0.4).
 */
export interface TokenBinding {
  write?: (input: WriteTokenInput) => Promise<Token>;
  claim?: (input: ClaimTokenInput) => Promise<Token>;
  read?: (input: ReadTokenInput) => Promise<Token | null>;
  delete?: (input: DeleteTokenInput) => Promise<void>;
  deleteAll?: (input: DeleteAllTokensInput) => Promise<number>;
}

/**
 * STUB (audit §V; substrate-side handoff
 * `docs/HANDOFF_RAINDB_TOKEN_BINDINGS.md` §C-§F).
 *
 * Idempotency-protected pointer-claim primitive. Tokens are the
 * substrate's "this scope is mine" exclusive marker.
 */
export const token = {
  /**
   * STUB. Write a token (overwrites existing claim by default).
   *
   * @throws BindingNotInstalled until substrate ships ctx.token.write
   * @throws AuthorRequired when options.author is missing
   * @throws ConditionFailed on CAS mismatch (when conditional flags supported)
   */
  async write(
    formationId: string,
    scopeValue: string,
    options: WriteTokenOptions,
  ): Promise<Token> {
    const ctx = resolveCtx();
    return stubOrDispatch<Token>(
      BINDING.token_write,
      () =>
        (ctx as unknown as { token?: TokenBinding }).token?.write,
      (fn) =>
        (fn as (i: WriteTokenInput) => Promise<Token>)({
          formationId,
          scopeValue,
          options,
        }),
      { formationId, scopeValue },
    );
  },

  /**
   * STUB. Claim a token: write with `createOnly: true` semantics.
   * Throws TokenExists on conflict so callers can ignore-on-init.
   *
   * @throws BindingNotInstalled
   * @throws TokenExists when the scope is already claimed
   * @throws AuthorRequired
   *
   * @example
   * ```ts
   * try {
   *   await token.claim('continuum-stats', 'global', { author: 'bot' });
   * } catch (e) {
   *   if (e instanceof TokenExists) {
   *     // already initialized; proceed
   *   } else throw e;
   * }
   * ```
   */
  async claim(
    formationId: string,
    scopeValue: string,
    options: Omit<WriteTokenOptions, 'createOnly'>,
  ): Promise<Token> {
    const ctx = resolveCtx();
    return stubOrDispatch<Token>(
      BINDING.token_claim,
      () =>
        (ctx as unknown as { token?: TokenBinding }).token?.claim,
      (fn) =>
        (fn as (i: ClaimTokenInput) => Promise<Token>)({
          formationId,
          scopeValue,
          options,
        }),
      { formationId, scopeValue },
    );
  },

  /**
   * STUB. Read the current token at a scope, or null if no claim.
   *
   * @throws BindingNotInstalled
   * @throws TokenExpired when the scope's token has been recycled
   */
  async read(
    formationId: string,
    scopeValue: string,
  ): Promise<Token | null> {
    const ctx = resolveCtx();
    return stubOrDispatch<Token | null>(
      BINDING.token_read,
      () =>
        (ctx as unknown as { token?: TokenBinding }).token?.read,
      (fn) =>
        (fn as (i: ReadTokenInput) => Promise<Token | null>)({
          formationId,
          scopeValue,
        }),
      { formationId, scopeValue },
    );
  },

  /**
   * STUB. Delete the token at a scope. No-op when no claim exists.
   *
   * @throws BindingNotInstalled
   */
  async delete(formationId: string, scopeValue: string): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.token_delete,
      () =>
        (ctx as unknown as { token?: TokenBinding }).token?.delete,
      (fn) =>
        (fn as (i: DeleteTokenInput) => Promise<void>)({
          formationId,
          scopeValue,
        }),
      { formationId, scopeValue },
    );
  },

  /**
   * STUB. Delete every token in a formation. Returns the count
   * deleted. Use sparingly -- this is the "wipe all claims" verb.
   *
   * @throws BindingNotInstalled
   */
  async deleteAll(formationId: string): Promise<number> {
    const ctx = resolveCtx();
    return stubOrDispatch<number>(
      BINDING.token_deleteAll,
      () =>
        (ctx as unknown as { token?: TokenBinding }).token?.deleteAll,
      (fn) =>
        (fn as (i: DeleteAllTokensInput) => Promise<number>)({
          formationId,
        }),
      { formationId },
    );
  },
};
