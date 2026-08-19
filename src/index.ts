/**
 * @raindb/bolt-sdk -- typed bindings over the goja sandbox for
 * Lightning Bolt handler authors. Zero runtime overhead.
 *
 * @see ~/src/raindb-prime/pkg/lightning -- the substrate bolt runtime:
 *   binding installers (pkg/lightning/engines/goja/bindings.go), the
 *   runtime SDK interface (pkg/lightning/runtime/engine.go), and the
 *   pod-engine dispatch (internal/lightning/podchannel). The code is
 *   the source of truth for which bindings are LIVE.
 *
 * This file is the public API. Internals under `src/internal/` are
 * not exported.
 */

// =====================================================================
// Version constant -- mirrors package.json. Update both together.
// =====================================================================
export const VERSION = '0.6.0';

// =====================================================================
// Runtime helpers (the ambient ctx resolver)
// =====================================================================
export { setCtx } from './runtime/ctx-resolver.js';

// =====================================================================
// Binding namespaces
// =====================================================================

// --- LIVE today (per audit §B) ---
export { log } from './bindings/log.js';
export { db } from './bindings/db.js';
export { fetch } from './bindings/fetch.js';
export { secrets } from './bindings/secrets.js';
export { ids } from './bindings/ids.js';
export { jwt } from './bindings/jwt.js';
export { crypto } from './bindings/crypto.js';
export { cookies } from './bindings/cookies.js';
export { iam } from './bindings/iam.js';
// --- LIVE since v0.4.0 (substrate commit 7bf58b6 -- unified IAM gate) ---
export { auth } from './bindings/auth.js';
export { response, startSSE, sseFrame } from './bindings/response.js';

// --- LIVE since v0.3.0 (substrate Wave 2.5 commit f934956) ---
export { schedule } from './bindings/schedule.js';

// --- STUBBED (audit §F-§S; substrate-side pending) ---
export { token } from './bindings/token.js';
export { stats } from './bindings/stats.js';
export { objects } from './bindings/objects.js';
export { sql, isBehind, isFresh, needsHarvest } from './bindings/sql.js';
export { relay } from './bindings/relay.js';
export { actions } from './bindings/actions.js';
/**
 * tags namespace -- {@link tags.tag} and {@link tags.untag} are
 * LIVE since v0.3.0 (route through `ctx.db.tag` / `ctx.db.untag`,
 * substrate commit eee3eac). {@link tags.replaceTags} stays STUB
 * (substrate did not ship an atomic replace binding -- emulate
 * via untag + tag when non-atomic is acceptable).
 */
export { tags } from './bindings/tags.js';
export { vectors } from './bindings/vectors.js';
export { files } from './bindings/files.js';
export { catalog } from './bindings/catalog.js';
export { formations } from './bindings/formations.js';
export { flows } from './bindings/flows.js';

// =====================================================================
// Per-binding interface types (for BoltContext consumers, advanced
// type composition, and the agent-bridge).
// =====================================================================

export type {
  DbBinding,
  ReadLatestInput,
  ReadDropletInput,
  WriteDropletInput,
  ListDropletsInput,
  ListKeysInput,
  ListSinceInput,
  WriteBatchInput,
  WriteBatchItem,
  WriteBatchOpts,
  WriteBatchResult,
  BatchItemResult,
  ReadAtInput,
  ReadCurrentInput,
  ExpireInput,
  TagInput,
  UntagInput,
  JsonOp,
  JsonOpIncrement,
  JsonOpSet,
  JsonOpMove,
  JsonOpWindowIncrement,
  MutateInput,
  MutateAndReadInput,
  WriteTokenDbInput,
  VersionHistoryInput,
  Revision,
} from './bindings/db.js';

export type { LogBinding } from './bindings/log.js';
export type { FetchBinding, FetchInit, FetchResponse } from './bindings/fetch.js';
export type { SecretsBinding } from './bindings/secrets.js';
export type { IdsBinding } from './bindings/ids.js';
export type { JwtBinding, JwtClaims } from './bindings/jwt.js';
export type { CryptoBinding } from './bindings/crypto.js';
export type { CookiesBinding, CookieOptions } from './bindings/cookies.js';
export type {
  IamBinding,
  WireTokenMintOptions,
  WireTokenResource,
} from './bindings/iam.js';
export type { AuthBinding } from './bindings/auth.js';
export type { ResponseBinding, SSEStream, SSEFrame } from './bindings/response.js';
export type {
  TokenBinding,
  WriteTokenInput,
  ClaimTokenInput,
  ReadTokenInput,
  DeleteTokenInput,
  DeleteAllTokensInput,
} from './bindings/token.js';
export type {
  StatsBinding,
  StatsIncrementInput,
  StatsSetInput,
  StatsBatchInput,
  StatsBatchEntry,
  StatsDrainInput,
} from './bindings/stats.js';
export type { ObjectsBinding } from './bindings/objects.js';
export type {
  SqlBinding,
  SqlQueryInput,
  SqlResult,
  SqlFreshnessRow,
  FreshnessStatus,
} from './bindings/sql.js';
export type {
  RelayBinding,
  WriteRelayInput,
  ReadRelayInput,
  UpdateRelayStatusInput,
  SpawnChildInput,
  WriteRelayLogInput,
  EnqueueTokenInput,
  DequeueTokenInput,
} from './bindings/relay.js';
export type {
  ActionsBinding,
  DispatchActionInput,
  DispatchActionResult,
  InvokeActionInput,
  InvokeActionResult,
} from './bindings/actions.js';
export type { TagsBinding, ReplaceTagsInput } from './bindings/tags.js';
export type {
  VectorsBinding,
  VectorQueryInput,
  VectorQueryByTextInput,
  VectorQueryOpts,
  VectorHit,
} from './bindings/vectors.js';
export type {
  FilesBinding,
  ReserveUploadInput,
  ReserveUploadResult,
  ReserveDownloadInput,
  ReserveDownloadResult,
  PushPublicInput,
  PushPublicResult,
  ReadMetaInput,
  ReadMetaResult,
} from './bindings/files.js';
export type {
  CatalogBinding,
  CatalogInsertInput,
  CatalogInsertResult,
  CatalogDeleteInput,
  CatalogUpdateInput,
  CatalogTransferInput,
  CatalogListInput,
  CatalogListEntry,
  CatalogListResult,
  CatalogTreeInput,
  CatalogTreeNode,
} from './bindings/catalog.js';
export type {
  FormationsBinding,
  FormationDescription,
  FormationSummary,
} from './bindings/formations.js';
export type {
  FlowsBinding,
  QueryFlowStateInput,
  FlowState,
} from './bindings/flows.js';
export type {
  ScheduleBinding,
  ScheduleInput,
} from './bindings/schedule.js';

// =====================================================================
// Shared types
// =====================================================================
export type {
  // Bolt-context family
  BoltContext,
  BoltMeta,
  BoltRequest,
  BoltTriggerRequest,
  BoltResponse,
  // Droplet family
  Droplet,
  DropletPage,
  DropletEnvelope,
  WriteResult,
  BulkDropletResult,
  KeyEntry,
  KeyPage,
  SincePage,
  // Token family
  Token,
  WriteTokenOptions,
  // Cursor family
  CursorPaginationOpts,
  CursorPage,
  // Relay family
  RelayAddress,
  RelayLogEntry,
  RelayResult,
  ReadRelayOptions,
  RelayDetails,
} from './types/index.js';

// =====================================================================
// Error classes
// =====================================================================
export {
  RainDBBoltError,
  CapabilityDenied,
  BindingNotInstalled,
  TokenExists,
  TokenExpired,
  ConditionFailed,
  StatsValidation,
  AuthorRequired,
  translateBindingError,
  type TranslateContext,
} from './errors/index.js';
