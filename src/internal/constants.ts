// internal/constants.ts -- single source location for every binding
// name string the package emits.
//
// Per handoff doc §K cross-cutting reference (which points back at
// PROJECT_REQUIREMENTS §3 in raindb-prime): no scattered
// magic strings. Every wrapper that names its binding for error
// translation, log tagging, or stub dispatch references one of these
// constants. When the substrate-side agent renames a binding (rare;
// the contract is supposed to be stable) the change lands here once
// and propagates everywhere.
//
// This file is INTERNAL -- not exported from the package's public
// surface. Consumers don't need to see binding names; they discover
// them through error.binding fields and JSDoc.

/**
 * Binding name string used in error.binding and stub-not-installed
 * messages. Format: `ctx.<namespace>.<method>` -- mirrors the goja
 * sandbox's installer naming so log lines from the package can be
 * cross-referenced against host-side log lines emitted by
 * `pkg/lightning/engines/goja/bindings.go`.
 */
export const BINDING = {
  // === LIVE bindings (per audit §B and bindings.go) ===
  log_info: 'ctx.log.info',
  log_warn: 'ctx.log.warn',
  log_error: 'ctx.log.error',

  db_readLatest: 'ctx.db.readLatest',
  db_readDroplet: 'ctx.db.readDroplet',
  db_writeDroplet: 'ctx.db.writeDroplet',
  db_listDroplets: 'ctx.db.listDroplets',

  fetch: 'ctx.fetch',

  secrets_get: 'ctx.secrets.get',

  ids_uuidv7: 'ctx.ids.uuidv7',

  jwt_sign: 'ctx.jwt.sign',
  jwt_verify: 'ctx.jwt.verify',

  crypto_hashPassword: 'ctx.crypto.hashPassword',
  crypto_verifyPassword: 'ctx.crypto.verifyPassword',
  crypto_randomBytes: 'ctx.crypto.randomBytes',

  cookies_parse: 'ctx.cookies.parse',
  cookies_build: 'ctx.cookies.build',

  iam_mintWireToken: 'ctx.iam.mintWireToken',

  // === ctx.auth -- LIVE since v0.4.0 (substrate commit 7bf58b6) ===
  //
  // The auth namespace exposes the per-request AuthContext that the
  // lightning dispatcher resolved by running the SAME GrantValidator
  // raindb-api's auth_middleware runs. The bolt's read-only surface
  // gates in-process privileged bindings (ctx.iam.mintWireToken,
  // future ctx.db.write to other tenants) via the user's actual
  // grant. ONE gate, two entry points (api + lightning), same
  // enforcement.
  //
  // Scalar accessors (tenantId, subject, apiClientId, isAnonymous)
  // are property reads -- no binding name needed (no possible
  // BindingNotInstalled at read time).
  //
  // Predicates carry binding names so capability denials translate
  // through the standard error pipeline.
  auth_permits: 'ctx.auth.permits',
  auth_permitsWireKeySubscribe: 'ctx.auth.permitsWireKeySubscribe',

  response_write: 'ctx.response.write',
  response_setHeader: 'ctx.response.setHeader',
  response_beginStream: 'ctx.response.beginStream',

  // === STUBBED bindings (substrate-side pending; see audit §F-§S) ===
  token_write: 'ctx.token.write',
  token_claim: 'ctx.token.claim',
  token_read: 'ctx.token.read',
  token_delete: 'ctx.token.delete',
  token_deleteAll: 'ctx.token.deleteAll',

  stats_increment: 'ctx.stats.increment',
  stats_set: 'ctx.stats.set',
  stats_batch: 'ctx.stats.batch',
  stats_drain: 'ctx.stats.drain',

  objects_get: 'ctx.objects.get',
  objects_put: 'ctx.objects.put',
  objects_exists: 'ctx.objects.exists',
  objects_delete: 'ctx.objects.delete',

  db_listKeys: 'ctx.db.listKeys',
  db_listSince: 'ctx.db.listSince',
  db_writeBatch: 'ctx.db.writeBatch',
  db_readAt: 'ctx.db.readAt',
  db_readCurrent: 'ctx.db.readCurrent',
  db_resolveFormation: 'ctx.db.resolveFormation',
  db_expire: 'ctx.db.expire',
  db_expirationDays: 'ctx.db.expirationDays',

  // === ctx.db.mutate / mutateAndRead / writeToken -- LIVE ===
  //
  // Atomic token read-modify-write (mutate / mutateAndRead) + token
  // write (writeToken). The substrate installs these on ctx.db in
  // pkg/lightning/engines/goja/bindings.go::installDBBinding and
  // enforces the per-formation capability gate host-side: OpMutate
  // ("mutate") for mutate/mutateAndRead, OpTokenWrite ("token-write")
  // for writeToken. mutateAndRead is the subtract-a-counter-and-read-
  // the-remaining-value primitive (backed by Client.MutateAndRead +
  // storage.JSONOpWindowIncrement -- the same passive-window-reset
  // mechanism pkg/sdk/fleet_ratelimit.go uses, no cron required).
  db_mutate: 'ctx.db.mutate',
  db_mutateAndRead: 'ctx.db.mutateAndRead',
  db_writeToken: 'ctx.db.writeToken',
  /**
   * LIVE since v0.3.0. The substrate installed tag/untag on
   * `ctx.db` (not a separate `ctx.tags` namespace); the canonical
   * binding strings reflect that. The legacy `tags_tag` / etc
   * constants remain for the SDK-level `tags.*` wrapper's
   * error.binding labels.
   */
  db_tag: 'ctx.db.tag',
  db_untag: 'ctx.db.untag',

  sql_query: 'ctx.sql.query',

  relay_write: 'ctx.relay.write',
  relay_read: 'ctx.relay.read',
  relay_updateStatus: 'ctx.relay.updateStatus',
  relay_spawnChild: 'ctx.relay.spawnChild',
  relay_writeLog: 'ctx.relay.writeLog',
  relay_enqueueToken: 'ctx.relay.enqueueToken',
  relay_dequeueToken: 'ctx.relay.dequeueToken',

  actions_dispatch: 'ctx.actions.dispatch',
  actions_invoke: 'ctx.actions.invoke',

  tags_tag: 'ctx.tags.tag',
  tags_untag: 'ctx.tags.untag',
  tags_replaceTags: 'ctx.tags.replaceTags',

  vectors_query: 'ctx.vectors.query',
  vectors_queryByText: 'ctx.vectors.queryByText',
  vectors_deleteFormation: 'ctx.vectors.deleteFormation',

  files_reserveUpload: 'ctx.files.reserveUpload',
  files_reserveDownload: 'ctx.files.reserveDownload',
  files_pushPublic: 'ctx.files.pushPublic',
  files_readMeta: 'ctx.files.readMeta',

  catalog_insert: 'ctx.catalog.insert',
  catalog_delete: 'ctx.catalog.delete',
  catalog_update: 'ctx.catalog.update',
  catalog_transfer: 'ctx.catalog.transfer',
  catalog_list: 'ctx.catalog.list',
  catalog_tree: 'ctx.catalog.tree',

  formations_describe: 'ctx.formations.describe',
  formations_list: 'ctx.formations.list',
  formations_warm: 'ctx.formations.warm',

  flows_queryState: 'ctx.flows.queryState',

  // === LIVE since v0.3.0 (substrate Wave 2.5 commit f934956) ===
  //
  // `ctx.schedule` is bolt-level (not formation-scoped); capability
  // gate is the manifest's `capabilities.raindb.schedule: true`
  // boolean (per runtime.OpSchedule). The substrate-side denial
  // message is `ctx.schedule: schedule capability not declared...`
  // -- it does NOT match CAPABILITY_DENIAL_REGEX's formation-shape,
  // so a capability denial falls through to a plain RainDBBoltError
  // carrying `binding: "ctx.schedule"` and the original message.
  schedule: 'ctx.schedule',
} as const;

/**
 * Stable type-name strings the substrate-side typed-error rejections
 * carry on `Error.name`. The package's translateBindingError() switches
 * on these strings to produce the right typed class.
 *
 * Per handoff doc §G + docs/HANDOFF_RAINDB_TOKEN_BINDINGS.md §C.
 */
export const ERROR_NAME = {
  TokenExists: 'TokenExists',
  TokenExpired: 'TokenExpired',
  ConditionFailed: 'ConditionFailed',
  StatsValidation: 'StatsValidation',
  AuthorRequired: 'AuthorRequired',
  // The substrate now classifies capability denials (formation-op AND
  // namespace-level like schedule/objects) with the name "CapabilityDenied"
  // (runtime.BoltErrorName), carried on Error.name across both engines. The
  // message-regex path below remains as a fallback for the formation-op
  // shape, but the name is now authoritative and also covers the
  // namespace-level denials the regex could not match.
  CapabilityDenied: 'CapabilityDenied',
} as const;

/**
 * Capability-denial error message regex. Per audit §W cross-cutting
 * concerns, the substrate emits capability errors as
 * `ctx.<binding>: <op> on formation "<formationId>" not declared in capabilities`.
 *
 * Open question 7 in the handoff doc: this regex assumes a stable
 * substrate-side message format. If the substrate reformats, this
 * regex will silently miss matches and the error falls through to
 * RainDBBoltError. The regex stays deliberately tolerant -- the op
 * group accepts hyphenated ops (`relay-write`, `object-read`).
 */
export const CAPABILITY_DENIAL_REGEX =
  /^ctx\.\w+(?:\.\w+)?: (\w+(?:-\w+)*) on formation "([^"]+)" not declared/;
