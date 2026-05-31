# Changelog

All notable changes to `@raindb/bolt-sdk` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package adheres to [semver](https://semver.org/).

Per the handoff doc §N, during the v0.x parallel-build phase: stubs may
be swapped to live at any minor version bump; type changes to LIVE
wrappers are breaking and trigger a minor version bump.

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
