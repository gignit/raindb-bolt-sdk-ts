// bindings/objects.ts -- STUBBED ctx.objects.* surface.
// Audit §F (Gap 1).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

/**
 * Bolt-facing shape of `ctx.objects` -- raw goja surface (STUB).
 */
export interface ObjectsBinding {
  get?: (bucket: string, key: string) => Promise<Uint8Array | string>;
  put?: (
    bucket: string,
    key: string,
    data: Uint8Array | string,
    contentType?: string,
  ) => Promise<void>;
  exists?: (bucket: string, key: string) => Promise<boolean>;
  delete?: (bucket: string, key: string) => Promise<void>;
}

/**
 * STUB (audit §F Gap 1). S3 bucket get/put surface.
 *
 * Capability: requires `object-read` / `object-write` declared on
 * the bolt manifest's `capabilities.raindb.buckets[]`.
 */
export const objects = {
  /**
   * STUB. Read object bytes from a declared bucket.
   *
   * @throws BindingNotInstalled until substrate ships ctx.objects.get
   * @throws RainDBBoltError on missing bucket capability
   */
  async get(bucket: string, key: string): Promise<Uint8Array | string> {
    const ctx = resolveCtx();
    return stubOrDispatch<Uint8Array | string>(
      BINDING.objects_get,
      () =>
        (ctx as unknown as { objects?: ObjectsBinding }).objects?.get,
      (fn) =>
        (
          fn as (b: string, k: string) => Promise<Uint8Array | string>
        )(bucket, key),
      { bucket, key },
    );
  },

  /**
   * STUB. Write object bytes to a declared bucket.
   *
   * @throws BindingNotInstalled
   */
  async put(
    bucket: string,
    key: string,
    data: Uint8Array | string,
    contentType?: string,
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.objects_put,
      () =>
        (ctx as unknown as { objects?: ObjectsBinding }).objects?.put,
      (fn) =>
        (
          fn as (
            b: string,
            k: string,
            d: Uint8Array | string,
            c?: string,
          ) => Promise<void>
        )(bucket, key, data, contentType),
      { bucket, key, contentType },
    );
  },

  /**
   * STUB. HEAD-shaped existence check.
   *
   * @throws BindingNotInstalled
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    const ctx = resolveCtx();
    return stubOrDispatch<boolean>(
      BINDING.objects_exists,
      () =>
        (ctx as unknown as { objects?: ObjectsBinding }).objects?.exists,
      (fn) =>
        (fn as (b: string, k: string) => Promise<boolean>)(bucket, key),
      { bucket, key },
    );
  },

  /**
   * STUB. Delete an object.
   *
   * @throws BindingNotInstalled
   */
  async delete(bucket: string, key: string): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.objects_delete,
      () =>
        (ctx as unknown as { objects?: ObjectsBinding }).objects?.delete,
      (fn) =>
        (fn as (b: string, k: string) => Promise<void>)(bucket, key),
      { bucket, key },
    );
  },
};
