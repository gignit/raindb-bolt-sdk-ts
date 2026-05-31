// bindings/files.ts -- STUBBED ctx.files.* surface.
// Audit §O (Gap 10).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface ReserveUploadInput {
  formationId: string;
  scopeValue: string;
  fieldName: string;
  opts?: {
    contentType?: string;
    maxBytes?: number;
    ttlSec?: number;
  };
}

export interface ReserveUploadResult {
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
  objectKey: string;
}

export interface ReserveDownloadInput {
  formationId: string;
  scopeValue: string;
  fieldName: string;
  opts?: { ttlSec?: number };
}

export interface ReserveDownloadResult {
  downloadUrl: string;
  expiresAt: string;
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
export const files = {
  /**
   * STUB. Reserve a pre-signed S3 upload URL the client uploads to
   * directly (no proxy through bolt).
   * @throws BindingNotInstalled
   */
  async reserveUpload(input: ReserveUploadInput): Promise<ReserveUploadResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<ReserveUploadResult>(
      BINDING.files_reserveUpload,
      () =>
        (ctx as unknown as { files?: FilesBinding }).files?.reserveUpload,
      (fn) =>
        (
          fn as (i: ReserveUploadInput) => Promise<ReserveUploadResult>
        )(input),
      input,
    );
  },

  /**
   * STUB. Reserve a pre-signed S3 download URL.
   * @throws BindingNotInstalled
   */
  async reserveDownload(
    input: ReserveDownloadInput,
  ): Promise<ReserveDownloadResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<ReserveDownloadResult>(
      BINDING.files_reserveDownload,
      () =>
        (ctx as unknown as { files?: FilesBinding }).files
          ?.reserveDownload,
      (fn) =>
        (
          fn as (i: ReserveDownloadInput) => Promise<ReserveDownloadResult>
        )(input),
      input,
    );
  },

  /**
   * STUB. Direct push to platform-public bucket (bolt has the bytes).
   * @throws BindingNotInstalled
   */
  async pushPublic(input: PushPublicInput): Promise<PushPublicResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<PushPublicResult>(
      BINDING.files_pushPublic,
      () =>
        (ctx as unknown as { files?: FilesBinding }).files?.pushPublic,
      (fn) =>
        (fn as (i: PushPublicInput) => Promise<PushPublicResult>)(input),
      {
        formationId: input.formationId,
        scopeValue: input.scopeValue,
        fieldName: input.fieldName,
        contentType: input.contentType,
      },
    );
  },

  /**
   * STUB. Read float-field metadata (size, contentType, etag, sha256).
   * @throws BindingNotInstalled
   */
  async readMeta(input: ReadMetaInput): Promise<ReadMetaResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<ReadMetaResult>(
      BINDING.files_readMeta,
      () =>
        (ctx as unknown as { files?: FilesBinding }).files?.readMeta,
      (fn) =>
        (fn as (i: ReadMetaInput) => Promise<ReadMetaResult>)(input),
      input,
    );
  },
};
