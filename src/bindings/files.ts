// bindings/files.ts -- ctx.files.* surface (file upload/download reservation).
//
// File upload/download is a LOW-FREQUENCY operation, so it is served over the
// RainDB GraphQL API via ctx.fetch (see runtime/graphql.ts) rather than a
// dedicated native goja/pod fast-path binding. reserveUpload + reserveDownload
// are LIVE via that route (they need only the RAINDB_GRAPHQL_ENDPOINT +
// RAINDB_GRAPHQL_KEY secrets declared -- see runtime/graphql.ts). If a future
// runtime installs a native ctx.files binding, these prefer it automatically.
//
// pushPublic + readMeta remain graphql-backable but are not implemented yet
// (no app has needed them); they throw a clear RainDBBoltError until added.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { RainDBBoltError } from '../errors/classes.js';
import { boltGraphQL } from '../runtime/graphql.js';
import type { FetchResponse } from './fetch.js';
import { fetch as ctxFetch } from './fetch.js';

export interface ReserveUploadInput {
  formationId: string;
  /** The file's filename (used for the float path + the reservation). */
  filename: string;
  /** MIME type of the upload. */
  contentType: string;
  /** Byte length of the file being uploaded. */
  fileSize: number;
  /** The write author for the droplet written alongside the reservation. */
  author: string;
  /** The droplet payload written with the reservation (entity fields). */
  payload?: Record<string, unknown>;
  /**
   * CAS guard for REPLACING/versioning an existing entity's file: pass the
   * current entry's dropletId. Omit for a first upload. On a `revisions:true`
   * float this yields a new retained version at `ver/<versionId>/`.
   */
  expectedPriorDropletId?: string;
}

export interface ReserveUploadResult {
  /** PUT the bytes here (presigned S3 URL, no proxy through the bolt). */
  uploadUrl: string;
  /** Headers to send with the PUT (includes x-amz-content-sha256). */
  headers: Record<string, string>;
  /** ISO 8601 expiry of the presigned URL. */
  expiresAt: string;
  /** The float object key the bytes land at (carries ver/<versionId>/). */
  objectKey: string;
  /** The entity's stable scopeValue (mint on a create). */
  scopeValue: string;
  /** The reserved droplet's id. */
  dropletId: string;
  /** Public URL when the float field is public. */
  publicUrl?: string;
}

export interface ReserveDownloadInput {
  formationId: string;
  /** The dropletId (revision) whose floated bytes to read. */
  dropletId: string;
}

export interface ReserveDownloadResult {
  /**
   * A `data:` URL of the fully-buffered bytes (directly usable). The GraphQL
   * route (`readFloat`) returns the bytes inline, NOT a presigned GET URL, so
   * this URL embeds the content and does NOT expire -- there is no server-side
   * artifact with a TTL. For large payloads read the bytes via `dataBase64`
   * rather than the data URL.
   */
  downloadUrl: string;
  contentType: string;
  size: number;
  /** The float's bytes, base64-encoded. This is the authoritative payload. */
  dataBase64: string;
}

export interface PushPublicInput {
  formationId: string;
  scopeValue: string;
  fieldName: string;
  data: Uint8Array | string;
  contentType: string;
}

export interface PushPublicResult {
  publicUrl: string;
  publicPath: string;
  contentType: string;
  size: number;
}

export interface ReadMetaInput {
  formationId: string;
  scopeValue: string;
  fieldName: string;
}

export interface ReadMetaResult {
  size: number;
  contentType: string;
  etag: string;
  sha256: string;
}

/**
 * Bolt-facing shape of `ctx.files` -- raw goja surface (STUB).
 */
export interface FilesBinding {
  reserveUpload?: (input: ReserveUploadInput) => Promise<ReserveUploadResult>;
  reserveDownload?: (
    input: ReserveDownloadInput,
  ) => Promise<ReserveDownloadResult>;
  pushPublic?: (input: PushPublicInput) => Promise<PushPublicResult>;
  readMeta?: (input: ReadMetaInput) => Promise<ReadMetaResult>;
}

/**
 * STUB (audit §O Gap 10). Public file storage + signed direct URLs.
 *
 * Cross-validation: pushPublic shape matches @raindb/agent's
 * `droplet_push_public` tool's `PushPublicResult`.
 */
// Native-binding preference: if a runtime ever installs ctx.files.<method>,
// use it; otherwise run the op over GraphQL. Keeps the wrapper future-proof
// without ever throwing BindingNotInstalled for the graphql-served methods.
function nativeFiles(): FilesBinding | undefined {
  return (resolveCtx() as unknown as { files?: FilesBinding }).files;
}

// --- GraphQL operation documents (low-frequency file ops) ---

const RESERVE_DIRECT_UPLOAD = `
  mutation($in: ReserveDirectUploadInput!) {
    reserveDirectUpload(input: $in) {
      scopeValue dropletId uploadUrl publicUrl expiresAt entityPath floatPath
    }
  }`;

const READ_FLOAT = `
  query($in: ReadFloatInput!) {
    readFloat(input: $in) { contentType size path bucket dataBase64 }
  }`;

export const files = {
  /**
   * Reserve a pre-signed S3 upload URL. The client (or the bolt) PUTs bytes
   * straight to `uploadUrl` -- no proxy through the bolt. On a formation whose
   * float field has `revisions: true`, each upload is retained as a new version
   * at `ver/<versionId>/`.
   *
   * LIVE over the GraphQL route (ctx.fetch). Requires the RAINDB_GRAPHQL_ENDPOINT
   * + RAINDB_GRAPHQL_KEY secrets (see runtime/graphql.ts). To replace/version an
   * existing entity's file, pass `opts.expectedPriorDropletId` (CAS guard).
   *
   * @param input.payload    the droplet payload written alongside the reservation
   * @param input.author     the write author (required by reserveDirectUpload)
   */
  async reserveUpload(input: ReserveUploadInput): Promise<ReserveUploadResult> {
    const native = nativeFiles()?.reserveUpload;
    if (typeof native === 'function') {
      return native(input) as Promise<ReserveUploadResult>;
    }

    const data = await boltGraphQL<{
      reserveDirectUpload: {
        scopeValue: string;
        dropletId: string;
        uploadUrl: string;
        publicUrl?: string | null;
        expiresAt: string;
        entityPath: string;
        floatPath: string;
      };
    }>(RESERVE_DIRECT_UPLOAD, {
      in: {
        formationId: input.formationId,
        filename: input.filename,
        contentType: input.contentType,
        fileSize: input.fileSize,
        author: input.author,
        ...(input.payload ? { payload: input.payload } : {}),
        ...(input.expectedPriorDropletId
          ? { expectedPriorDropletId: input.expectedPriorDropletId }
          : {}),
      },
    });
    const r = data.reserveDirectUpload;
    return {
      uploadUrl: r.uploadUrl,
      headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
      expiresAt: r.expiresAt,
      objectKey: r.floatPath,
      scopeValue: r.scopeValue,
      dropletId: r.dropletId,
      ...(r.publicUrl ? { publicUrl: r.publicUrl } : {}),
    };
  },

  /**
   * Download a floated file's BYTES for a specific revision. Because a
   * `revisions: true` float retains every version, any historical dropletId
   * resolves that version's bytes -- the per-version-download capability.
   *
   * LIVE over the GraphQL route (readFloat). Returns the bytes FULLY BUFFERED
   * as base64 plus a self-contained `data:` URL; it is NOT a presigned GET and
   * NOT an expiring server artifact (there is nothing with a TTL to expire).
   * Suitable for small results; it cannot carry an unbounded lossless dataset
   * (that is the scientific-export follow-up, not this helper).
   *
   * @param input.dropletId the revision to fetch (any retained version)
   */
  async reserveDownload(input: ReserveDownloadInput): Promise<ReserveDownloadResult> {
    const native = nativeFiles()?.reserveDownload;
    if (typeof native === 'function') {
      return native(input) as Promise<ReserveDownloadResult>;
    }
    const dropletId = input.dropletId;
    const data = await boltGraphQL<{
      readFloat: { contentType: string; size: number; dataBase64: string } | null;
    }>(READ_FLOAT, { in: { formationId: input.formationId, dropletId } });
    if (!data.readFloat) {
      throw new RainDBBoltError(
        `files.reserveDownload: no float for droplet ${dropletId} in ${input.formationId}`,
        { binding: 'ctx.files.reserveDownload', input },
      );
    }
    // The GraphQL route returns bytes, not a presigned URL -- expose both a
    // self-contained data: URL (usable directly, never expires) and the raw
    // base64 + metadata. No fabricated expiresAt: nothing here has a TTL.
    const f = data.readFloat;
    return {
      downloadUrl: `data:${f.contentType};base64,${f.dataBase64}`,
      contentType: f.contentType,
      size: f.size,
      dataBase64: f.dataBase64,
    };
  },

  /**
   * Not yet implemented. pushPublic mirrors the GraphQL pushToPublic float op;
   * add a graphql-backed implementation here when an app needs it (the pattern
   * is reserveUpload above). Throws a clear error until then.
   */
  async pushPublic(input: PushPublicInput): Promise<PushPublicResult> {
    void ctxFetch;
    throw new RainDBBoltError(
      'ctx.files.pushPublic is not implemented yet. It can be added as a ' +
        'graphql-backed op (see files.reserveUpload). For public mirroring today, ' +
        'declare the float field public:true in the formation config so writes ' +
        'auto-mirror.',
      { binding: 'ctx.files.pushPublic', input: { formationId: input.formationId } },
    );
  },

  /**
   * Not yet implemented. readMeta (size/contentType/etag/sha256) can be derived
   * from a droplet's floatMeta (db.readDroplet) or added as a graphql op when
   * needed. Throws a clear error until then.
   */
  async readMeta(input: ReadMetaInput): Promise<ReadMetaResult> {
    throw new RainDBBoltError(
      'ctx.files.readMeta is not implemented yet. Read the droplet ' +
        '(ctx.db.readDroplet) and inspect its floatMeta for size/contentType, or ' +
        'add a graphql-backed readMeta here when needed.',
      { binding: 'ctx.files.readMeta', input },
    );
  },
};
