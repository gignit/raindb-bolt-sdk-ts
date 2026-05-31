// bindings/objects.ts -- typed wrapper for ctx.objects.*.
//
// LIVE since v0.2.0 -- substrate landed the native binding in
// phoenix commit af5e9eb (merged to main as part of
// architect/wave-1-merge). The goja installer is in
// `pkg/lightning/engines/goja/bindings.go::installObjectsBinding`;
// the SDK contract is the `SDKObjects` interface in
// `pkg/lightning/runtime/engine.go` (~lines 706-729).
//
// Calling convention: the goja binding takes positional args
// `(bucket, key, [data, contentType])`. The wrapper exposes the
// same positional signature (rather than a named-args object) to
// stay close to S3-shaped vocabulary. Capability gating happens
// in the substrate at op `object-read` (get/exists) and
// `object-write` (put/delete); capability denials translate to
// {@link CapabilityDenied} via `translateBindingError`.
//
// Substrate-side bytes are surfaced as a JS string per the goja
// installer (the goja runtime does not expose a native Uint8Array
// conversion). The wrapper types `get` as `Promise<string>` --
// Uint8Array return is deferred to a follow-up substrate cut.
//
// Backwards compatibility: bolts running against an OLDER lightning
// binary (pre-af5e9eb) get a clean {@link BindingNotInstalled} from
// the guard at the top of each method, rather than a cryptic
// undefined-deref.
//
// Audit reference: §F (Gap 1).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BindingNotInstalled } from '../errors/classes.js';
import { BINDING } from '../internal/constants.js';

/**
 * Shape of `ctx.objects` as the goja sandbox installs it. LIVE
 * since v0.2.0.
 *
 * For bolt authors: prefer the package's exported `objects` const
 * (typed errors via `translateBindingError`). This raw type exists
 * so `BoltContext.objects` is faithful to what `ctx` actually
 * carries -- direct calls work as an escape hatch.
 *
 * Every method's presence is technically optional (BoltContext.objects
 * is `objects?: ObjectsBinding` for backwards-compat with older
 * substrate binaries); within the namespace, the methods are
 * required by the contract.
 */
export interface ObjectsBinding {
  /**
   * Read object bytes from a declared bucket. Returns a string
   * per the goja installer's convention.
   */
  get(bucket: string, key: string): Promise<string>;
  put(
    bucket: string,
    key: string,
    data: Uint8Array | string,
    contentType?: string,
  ): Promise<void>;
  exists(bucket: string, key: string): Promise<boolean>;
  delete(bucket: string, key: string): Promise<void>;
}

/** Internal: shared "namespace missing" error producer. */
function missingObjects(binding: string, input: unknown): never {
  throw new BindingNotInstalled(
    `${binding} requires ctx.objects which is not installed in this ` +
      `bolt runtime. The @raindb/bolt-sdk wrapper is LIVE since v0.2.0; ` +
      `the substrate-side binding landed in phoenix commit af5e9eb. ` +
      `If you see this on a current lightning binary, capabilities.json ` +
      `is likely missing a buckets[] declaration. See ` +
      `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md §F ` +
      `for the gap card that owns this surface.`,
    { binding, input },
  );
}

/**
 * The ctx.objects namespace -- LIVE wrapper over the substrate's
 * bucket get/put/exists/delete surface.
 *
 * Capability: requires `object-read` or `object-write` declared on
 * the bolt manifest's `capabilities.raindb.buckets[]` rows. The
 * substrate enforces; the wrapper translates rejection messages
 * to {@link CapabilityDenied} via `translateBindingError`.
 *
 * Audit §F (Gap 1). Substrate-side commit: af5e9eb. Substrate
 * minimum: any lightning binary built from main on or after the
 * Wave 1 merge.
 */
export const objects = {
  /**
   * Read object bytes from a declared bucket.
   *
   * LIVE binding.
   *
   * @requires capability: `object-read` on the bucket
   * @returns the object bytes as a string. Bolts that need the
   *   raw byte view can call `new TextEncoder().encode(s)` or
   *   `Buffer.from(s, 'binary')` on the result. Uint8Array return
   *   is deferred to a follow-up substrate version (the goja
   *   installer surfaces bytes as string in Tier 1 -- see
   *   `installObjectsBinding` in bindings.go).
   * @throws CapabilityDenied when the bolt's capabilities.json
   *   does not declare `object-read` on the bucket
   * @throws BindingNotInstalled when running against a lightning
   *   binary that pre-dates phoenix commit af5e9eb
   *
   * @example
   * ```ts
   * import { objects } from '@raindb/bolt-sdk';
   * const spec = await objects.get('platform-public', 'specs/openapi.json');
   * const parsed = JSON.parse(spec);
   * ```
   */
  async get(bucket: string, key: string): Promise<string> {
    const ctx = resolveCtx();
    if (ctx.objects === undefined) {
      missingObjects(BINDING.objects_get, { bucket, key });
    }
    try {
      const out = await ctx.objects.get(bucket, key);
      return out as string;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.objects_get,
        input: { bucket, key },
      });
    }
  },

  /**
   * Write object bytes to a declared bucket. The substrate
   * forwards the bytes plus the optional Content-Type header to
   * the underlying S3 PutObject.
   *
   * LIVE binding.
   *
   * @requires capability: `object-write` on the bucket
   * @param data string or Uint8Array. The substrate accepts both;
   *   strings are sent as UTF-8 bytes (the goja installer does the
   *   conversion in `installObjectsBinding`).
   * @param contentType optional MIME type; omit to let S3 choose
   *   the default (`application/octet-stream`).
   * @throws CapabilityDenied
   * @throws BindingNotInstalled when ctx.objects is not present
   *
   * @example
   * ```ts
   * await objects.put(
   *   'tenant-standard',
   *   'reports/2026-05-30.json',
   *   JSON.stringify(report),
   *   'application/json',
   * );
   * ```
   */
  async put(
    bucket: string,
    key: string,
    data: Uint8Array | string,
    contentType?: string,
  ): Promise<void> {
    const ctx = resolveCtx();
    if (ctx.objects === undefined) {
      missingObjects(BINDING.objects_put, { bucket, key, contentType });
    }
    try {
      await ctx.objects.put(bucket, key, data, contentType);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.objects_put,
        input: { bucket, key, contentType },
      });
    }
  },

  /**
   * HEAD-shaped existence check. Does NOT fetch the object payload.
   *
   * LIVE binding.
   *
   * @requires capability: `object-read` on the bucket
   * @returns true when the object is present; false otherwise.
   * @throws CapabilityDenied
   * @throws BindingNotInstalled when ctx.objects is not present
   *
   * @example
   * ```ts
   * if (await objects.exists('tenant-standard', 'reports/today.json')) {
   *   // skip regeneration
   * }
   * ```
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    const ctx = resolveCtx();
    if (ctx.objects === undefined) {
      missingObjects(BINDING.objects_exists, { bucket, key });
    }
    try {
      const out = await ctx.objects.exists(bucket, key);
      return out as boolean;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.objects_exists,
        input: { bucket, key },
      });
    }
  },

  /**
   * Delete an object. Idempotent on the substrate side (deleting
   * a missing key is not an error).
   *
   * LIVE binding.
   *
   * @requires capability: `object-write` on the bucket
   * @throws CapabilityDenied
   * @throws BindingNotInstalled when ctx.objects is not present
   *
   * @example
   * ```ts
   * await objects.delete('tenant-standard', 'tmp/expired.bin');
   * ```
   */
  async delete(bucket: string, key: string): Promise<void> {
    const ctx = resolveCtx();
    if (ctx.objects === undefined) {
      missingObjects(BINDING.objects_delete, { bucket, key });
    }
    try {
      await ctx.objects.delete(bucket, key);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.objects_delete,
        input: { bucket, key },
      });
    }
  },
};
