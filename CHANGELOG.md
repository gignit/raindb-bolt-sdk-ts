# Changelog

All notable changes to `@raindb/bolt-sdk` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package adheres to [semver](https://semver.org/).

Per the handoff doc §N, during the v0.x parallel-build phase: stubs may
be swapped to live at any minor version bump; type changes to LIVE
wrappers are breaking and trigger a minor version bump.

## [0.2.0] - 2026-05-31

Wave 2 release: swap the four Tier 1 stubs to LIVE wrappers.

Substrate-side reference: phoenix commit `af5e9eb` on
`substrate/tier-1-objects-listkeys-sql`, merged to main as part of
`architect/wave-1-merge`. Coordination ledger:
`~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md`.

### Swapped from STUB to LIVE

- **`objects.{get,put,exists,delete}`** -- audit §F (Gap 1).
  Goja installer in `installObjectsBinding`. Positional args
  `(bucket, key, [data, contentType])`. Capability ops:
  `object-read` (get/exists), `object-write` (put/delete) on
  buckets declared in `capabilities.raindb.buckets[]`.
- **`db.listKeys`** -- audit §G (Gap 2). Goja installer in
  `installDBBinding`. Positional args `(formationId, indexId,
  opts?)` where opts is `{first, after, last, before, prefix}`.
  Relay-shape pagination. Capability op: `list` on the formation.
- **`db.listSince`** -- audit §G (Gap 2). Goja installer in
  `installDBBinding`. Positional args `(formationId, sinceCursor,
  opts?)`. Returns full droplets (new {@link SincePage} type, NOT
  KeyPage as the v0.1 stub had typed it -- see "Shape divergences"
  below). Capability op: `list` on the formation.
- **`sql.query`** -- audit §H (Gap 3). Goja installer in
  `installSQLBinding`. Positional args `(sql, opts?)` where opts
  is `{formationId, timeoutMs, withFreshness}`. Capability op:
  `sql-read` (bolt-level, declared as
  `capabilities.raindb.sqlRead: true`).

### Shape divergences from v0.1 stubs

The substrate's actual contract differed from three v0.1 stub
shapes; the substrate wins per the handoff's "bolt-sdk's role is
to mirror the substrate; it doesn't drive shape decisions"
discipline:

1. **`SqlResult.rows` is now `unknown[][]` (positional rows)**,
   not `Array<Record<string, unknown>>` (named rows) as the v0.1
   stub had. The substrate's `runtime.SQLResult.Rows` is `[][]any`
   per `pkg/lightning/runtime/engine.go`, matching the GraphQL
   `SQLResult.rows` shape so the bolt-side wrapper is a drop-in
   replacement for the `ctx.fetch->/graphql` route. Bolts now look
   up by column index: `const i = result.columns.indexOf('name');
   const val = result.rows[r]?.[i]`.

2. **`SqlFreshnessRow` shape rewritten** to match
   `runtime.FormationLatest`: `{formationId, snapshotCursor,
   currentLatest, stale}`. The v0.1 stub had guessed a different
   shape with snapshot droplet IDs/keys; that shape did not
   correspond to anything the substrate produces. Tier 1 still
   returns `latest` empty (Wave 1 deferred the freshness bookmark
   to v0.3+ per substrate brain doc decision 4); the shape is
   declared correctly so the wrapper is forward-compatible.

3. **`SincePage` introduced as a distinct type** for
   `db.listSince` returns. The v0.1 stub had typed listSince as
   returning `KeyPage`; the substrate's `ListSincePage.Droplets`
   is `[]map[string]any` (full droplets, not keys-only), projected
   on the JS side via `listSincePageToJS`. The new `SincePage`
   carries `{droplets: Droplet[], hasMore, nextCursor?}`. Bolts
   that imported the v0.1 `listSince` (which threw
   BindingNotInstalled at runtime, so consumer code is rare) need
   to update their result handling from `result.keys` to
   `result.droplets`.

### Added

- **`KeyEntry.etag?: string`** optional field, surfaced by the
  substrate's `ListKeyEntry.ETag` when non-empty. The goja
  installer (`listKeysPageToJS`) omits the field on empty ETags.
  Agent-shape compat with `@raindb/agent`'s `KeyEntry` preserved
  via TypeScript's structural-typing tolerance for extra optional
  fields.
- **`SincePage` type** in `src/types/droplet.ts`, re-exported via
  `src/types/index.ts` and the package root.
- **`SqlFreshnessRow` type** rewritten in `src/bindings/sql.ts` to
  match the substrate's `FormationLatest` shape.
- **Three new example-bolt handlers** under
  `test/integration/example-bolt/src/handlers/`:
  - `object-roundtrip.ts` -- put/get/exists/delete roundtrip
  - `keys-walk.ts` -- paginated db.listKeys walk
  - `sql-probe.ts` -- trivial sql.query against `SELECT 1 AS one`
  Plus `bolt.json` updates declaring the
  `tenant-standard` bucket capability and `sqlRead: true`.
- **21 new unit tests** in `test/unit/v0_2-tier-1-swap.test.ts`
  covering happy-path, capability-denial, and binding-missing
  paths for each of the four newly-LIVE wrappers. Combined with
  the 63 v0.1 tests, the package now ships with 84 unit tests
  (all green).

### Changed

- `DbBinding.listKeys` and `DbBinding.listSince` types updated to
  reflect the goja installer's actual positional-args convention
  (matching the substrate). The optional `?` on these two methods
  is retained for backwards compatibility with older lightning
  binaries (pre-af5e9eb); the wrapper guards with a clean
  `BindingNotInstalled` rather than crashing.
- `ObjectsBinding` methods are no longer marked optional within
  the namespace (the binding either ships entirely or not at all).
  `BoltContext.objects` remains optional for the same backwards-
  compatibility reason.
- Package `version` bumped from `0.1.0` to `0.2.0`. `VERSION`
  constant in `src/index.ts` updated to match.

### Notes for the next agent

- The four bindings flipped from `STUB` to `LIVE-SINCE-v0.2.0` in
  `~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md`.
- The example-bolt's `bolt.json` now declares
  `capabilities.raindb.buckets` and `capabilities.raindb.sqlRead`;
  the substrate-side capability schema validator should accept both
  (per audit §F and §H). If validation fails, coordinate with the
  substrate-side agent.
- The `sql.query` wrapper repacks named-args input into the goja
  binding's positional `(sql, opts)` convention. The wrapper
  deliberately omits undefined fields from `opts` so the substrate
  sees "absent" rather than "zero" -- relevant for the
  `withFreshness` flag's tristate (absent / false / true).

## [0.1.0] - 2026-05-30

### Added

- Initial release.
- **LIVE wrappers** (substrate ships these today; the package dispatches through):
  - `log.{info,warn,error}`
  - `db.readLatest`, `db.readDroplet`, `db.writeDroplet`, `db.listDroplets`
  - `fetch` (callable)
  - `secrets.get`
  - `ids.uuidv7`
  - `jwt.sign`, `jwt.verify`
  - `crypto.hashPassword`, `crypto.verifyPassword`, `crypto.randomBytes`
  - `cookies.parse`, `cookies.build`
  - `iam.mintWireToken`
  - `response.setHeader`, `response.beginStream`, `response.write` (streaming routes only)
- **STUBBED wrappers** (will throw `BindingNotInstalled` until substrate ships):
  - `token.{write,claim,read,delete,deleteAll}` (audit §V; substrate-side handoff doc `HANDOFF_RAINDB_TOKEN_BINDINGS.md`)
  - `stats.{increment,set,batch,drain}` (audit §V)
  - `objects.{get,put,exists,delete}` (audit §F Gap 1)
  - `db.{listKeys,listSince}` (audit §G Gap 2)
  - `sql.query` (audit §H Gap 3)
  - `db.writeBatch` (audit §I Gap 4)
  - `relay.{write,read,updateStatus,spawnChild,writeLog,enqueueToken,dequeueToken}` (audit §J Gap 5; CONTRACT-UNCERTAIN)
  - `actions.{dispatch,invoke}` (audit §K Gap 6)
  - `tags.{tag,untag,replaceTags}` (audit §L Gap 7)
  - `db.{expire,expirationDays}` (audit §M Gap 8)
  - `vectors.{query,queryByText,deleteFormation}` (audit §N Gap 9; CONTRACT-UNCERTAIN)
  - `files.{reserveUpload,reserveDownload,pushPublic,readMeta}` (audit §O Gap 10)
  - `catalog.{insert,delete,update,transfer,list,tree}` (audit §P Gap 11; CONTRACT-UNCERTAIN)
  - `formations.{describe,list,warm}` (audit §Q Gap 12)
  - `db.readAt`, `flows.queryState` (audit §R Gap 13)
  - `db.readCurrent`, `db.resolveFormation`, `BoltMeta.{standardBucket,publicBucket,region}` (audit §S Gap 14)
- **Typed error classes**: `RainDBBoltError`, `CapabilityDenied`, `BindingNotInstalled`, `TokenExists`, `TokenExpired`, `ConditionFailed`, `StatsValidation`, `AuthorRequired`. Plus `translateBindingError` for binding-error->typed-class translation.
- **Types**: `BoltContext`, `BoltMeta`, `BoltRequest`, `BoltTriggerRequest`, `BoltResponse`, `Droplet`, `DropletPage`, `DropletEnvelope`, `WriteResult`, `BulkDropletResult`, `KeyEntry`, `KeyPage`, `Token`, `WriteTokenOptions`, `CursorPaginationOpts`, `CursorPage`, `RelayAddress`, `RelayLogEntry`, `RelayResult`, `ReadRelayOptions`, `RelayDetails`. Plus per-binding `*Binding` interface types.
- **Runtime**: `setCtx(ctx)` ambient resolver. Required as the first line of every bolt handler.
- **agent-bridge submodule**: `makeBoltNativeHost(ctx)` factory builds an `@raindb/agent`-shaped `AgentHost` whose `fetch` intercepts substrate-touching GraphQL queries and dispatches through native bindings. Falls through to `ctx.fetch` for non-substrate URLs and unknown GraphQL operations. v0.1.0 routes `readLatest`, `readDroplet`, `writeDroplet`, `listDroplets` natively.
- **Tests**: 63 unit tests covering every wrapper (happy path + error translation), every error class, every stub's BindingNotInstalled path, and shape-compat between the package's types and `@raindb/agent`'s wire shapes. The example-bolt at `test/integration/example-bolt/` is a runnable bolt-shaped TypeScript module that exercises the LIVE bindings; its e2e harness gates behind `RAINDB_DEVZ_PROFILE`.
- **Documentation**: README.md covering quick start, error handling, agent-bridge composition, stubbed-binding behavior, migration from raw `ctx.*` calls, and a compatibility table. CONTRIBUTING.md documenting the swap-stub-to-live protocol per handoff §O acceptance criterion 14.

### Notes for the next agent

- `BOLT_SDK_COORDINATION.md` (in raindb-phoenix-lightning) is the live ship-status ledger. When you swap a stub to live, update both columns of that file in your PR.
- The `BINDING` constants in `src/internal/constants.ts` are the single source location for binding names; never hardcode strings elsewhere.
- The `translateBindingError` regex in `src/internal/constants.ts::CAPABILITY_DENIAL_REGEX` assumes the substrate emits capability errors as `ctx.<binding>: <op> on formation "<name>" not declared`. If the substrate reformats, the regex misses and capability errors fall through to plain `RainDBBoltError`. Open question 7 in the handoff doc -- coordinate with the substrate-side agent before changing.

[0.1.0]: https://github.com/gignit/raindb-bolt-sdk-ts/releases/tag/v0.1.0
[0.2.0]: https://github.com/gignit/raindb-bolt-sdk-ts/releases/tag/v0.2.0
