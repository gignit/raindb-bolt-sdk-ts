# Changelog

All notable changes to `@raindb/bolt-sdk` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package adheres to [semver](https://semver.org/).

Per the handoff doc §N, during the v0.x parallel-build phase: stubs may
be swapped to live at any minor version bump; type changes to LIVE
wrappers are breaking and trigger a minor version bump.

## [0.6.0] - 2026-07-24

Consistency pass: resolve the drift that accumulated as the SDK was
extended binding-by-binding without a refactor. No new bindings; the
LIVE surface is unchanged. Three fixes make the package internally
consistent and the agent-bridge complete.

### Fixed

- **agent-bridge routing table completed.** `agent-bridge/host.ts`'s
  `tryRouteToNative` only routed the four v0.1 operations
  (`readLatest`/`readDroplet`/`writeDroplet`/`listDroplets`). Every
  binding that went LIVE since (`listKeys`, `executeSQL`, `tagEntity`,
  `untagEntity`, `expireDroplet`) was absent, so an `@raindb/agent`-driven
  bolt still made an HTTP self-loop back through `/graphql` for those
  operations instead of taking the in-process native binding (~1000x
  less Go resource, ~400x faster). The table now routes every substrate
  operation the agent tool catalog emits AND for which a LIVE native
  binding exists. Operations whose bindings are still STUB (catalog*,
  pushPublic, vectorSearch, readCurrent, readRelay, describeFormation)
  intentionally fall through to `ctx.fetch` until the native binding
  ships. 5 new agent-bridge tests pin the routing (native path taken,
  `ctx.fetch` NOT called, correct data envelope projected).
- **Dead-repo doc references removed.** 18 references to the retired
  `~/src/raindb-phoenix-lightning` tree (in `BindingNotInstalled`
  messages, `stubOrDispatch`, and JSDoc `@see`s across constants.ts,
  binding-not-installed.ts, db.ts, sql.ts, objects.ts, auth.ts,
  bolt-context.ts, index.ts) now point at the live substrate
  (`raindb-prime pkg/lightning/...`), which is the source of truth for
  which bindings are LIVE. The `binding-not-installed` test asserting
  the old doc path is updated accordingly.
- **`mutate`/`mutateAndRead`/`writeToken` error messages** aligned to
  the same LIVE-method shape the sibling `db` methods use (reference the
  substrate installer, not a one-off "installDBBinding" string).

### Docs

- README LIVE/STUB tables refreshed to reality: `db` now lists all
  fourteen LIVE methods; `objects`/`sql`/`schedule` moved to LIVE;
  the STUB table trimmed to the genuinely-pending bindings; a note
  documents `db.mutate`/`mutateAndRead`/`writeToken` + the
  windowIncrement passive-reset quota pattern.

## [0.5.0] - 2026-07-24

Add three atomic token read-modify-write bindings to `ctx.db`. New
LIVE wrappers (the substrate ships all three in `installDBBinding`);
the droplet read/write/list methods are untouched.

Substrate-side reference: the bindings land in
`pkg/lightning/engines/goja/bindings.go::installDBBinding` (goja) +
`internal/lightning/podchannel/dispatch.go` (pod parity), backed by
`sdk.Client.{Mutate,MutateAndRead,WriteToken}`. The new formation op
`mutate` (`runtime.OpMutate`) is added to `AllowedFormationOps` and to
the raindb-base manifest-capability schema enum in lockstep (guarded by
`internal/lightning/manifest_schema_drift_test.go`).

### Added

- **`db.mutate(formationId, scopeValue, ops)`** -- atomic
  read-modify-write on a cache-backed token entity. `ops` is a
  discriminated union over the substrate's canonical JSON-op codec
  (`increment` / `set` / `move` / `windowIncrement`); the wrapper
  passes them through as-is (the host decodes via
  `storage.DecodeJSONOps`, no client-side re-implementation).
  Capability op: `mutate` on the formation.
- **`db.mutateAndRead(formationId, scopeValue, ops, readPaths)`** --
  the same atomic mutate plus a read-back of the post-mutation int64
  values at `readPaths`, in ONE op. This is the subtract-a-counter-
  and-read-the-remaining-value primitive: pair a `windowIncrement` op
  with a read of the count path to bump a monthly quota and learn the
  new total in one call, with the window passively resetting on
  rollover (no cron). Mirrors the substrate's fleet rate-limiter
  (`pkg/sdk/fleet_ratelimit.go`). Capability op: `mutate`.
- **`db.writeToken(formationId, payload)`** -- write a token droplet
  to a token formation (distinct from `writeDroplet`, which routes
  entity formations). The substrate stamps the author (`bolt:<boltId>`)
  and resolves the scopeValue from the payload's scopeKey. Capability
  op: `token-write` (the reserved `runtime.OpTokenWrite` that had no
  binding until now).
- **JSON-op types**: `JsonOp` (discriminated union) +
  `JsonOpIncrement`, `JsonOpSet`, `JsonOpMove`, `JsonOpWindowIncrement`.
  Plus `MutateInput`, `MutateAndReadInput`, `WriteTokenDbInput`
  (named `WriteTokenDbInput` to disambiguate from the `token`
  namespace's `WriteTokenInput`).
- **`BINDING.db_mutate` / `db_mutateAndRead` / `db_writeToken`**
  constants in `src/internal/constants.ts`.
- **`DbBinding.mutate` / `mutateAndRead` / `writeToken`** raw
  positional-args methods (typed optional for backwards-compat with
  lightning binaries that pre-date the bindings; the wrapper guards
  with `BindingNotInstalled`).
- **10 new unit tests** in `test/unit/db-mutate.test.ts` (happy-path
  incl. a `windowIncrement` round-trip, capability-denial, and
  binding-missing for each of the three bindings). Total 117 unit
  tests (all green).

### Fixed

- Two stale `sql.query` test mocks (`test/unit/binding-not-installed.test.ts`,
  `test/unit/v0_2-tier-1-swap.test.ts`) returned positional `rows`
  (`[[1]]`) after commit `4e1b5ef` changed `SqlResult.rows` to named
  (column-keyed) objects. Updated the mocks + the one dependent
  assertion to the named-row shape. Pre-existing breakage, unrelated
  to the mutate bindings; fixed here to keep the suite green.

### Authority note

`db.mutate` / `mutateAndRead` delegate to the PLAIN
`Client.Mutate` / `MutateAndRead` (tenant-scoped authority), NOT an
admin-flip variant -- the same path the fleet rate-limiter uses for
its own tenant meter. A bolt mutating a platform-owned protected token
(admin != the bolt's tenant) is correctly denied by the substrate's
`authorizeWrite` wall; the binding does not silently escalate. A
formation whose quota token is tenant-owned works directly.

## [0.4.0] - 2026-06-XX

Add `ctx.auth` -- the per-request AuthContext the lightning
dispatcher resolves by running the SAME GrantValidator raindb-api's
auth middleware runs. Substrate reference: the unified-IAM-gate work
(`ctx.auth` installer in `installAuthBinding`). Scalar accessors
(`tenantId`, `subject`, `apiClientId`, `isAnonymous`) plus the
`permits` / `permitsWireKeySubscribe` predicates.

(This entry backfills the 0.4.0 release, which bumped the package
version + added the `auth` binding but was not recorded in the
changelog at the time.)

## [0.3.0] - 2026-05-31

Wave 3A release: swap the four Tier 2 + Wave 2.5 stubs to LIVE
wrappers.

Substrate-side references:
- phoenix merge commit `eee3eac` (Tier 2: tag/untag, expire/
  expirationDays, writeBatch). Originating branch
  `substrate/tier-2-tag-expire-writebatch`, internal commit
  `e09351f`.
- phoenix merge commit `f934956` (Wave 2.5 actions precursor:
  bolt-callback + ctx.schedule). Originating branch
  `substrate/wave-2_5-actions-precursor`, internal commit
  `48059e1`.

Coordination ledger:
`~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md`.

### Swapped from STUB to LIVE

- **`db.tag`** -- audit §L (Gap 7). Goja installer in
  `installDBBinding` exposing `ctx.db.tag(formationId, scopeValue,
  tags)`. Tags shape is `Record<string, string>` (S3 tag
  key=value pairs). Capability op: `tag` on the formation (NEW
  canonical op, distinct from `write` -- a bolt with droplet-write
  access may not need tag-mutation access and vice versa). The
  ergonomic `tags.tag(formationId, scopeValue, tags)` namespace
  re-routes through the new `db.tag`.
- **`db.untag`** -- audit §L (Gap 7). `ctx.db.untag(formationId,
  scopeValue, tagKeys)`. `tagKeys` is the list of KEY names to
  remove (not values). Capability op: `tag`. Idempotent
  substrate-side. The ergonomic `tags.untag(...)` re-routes.
- **`db.expire`** -- audit §M (Gap 8). `ctx.db.expire(formationId,
  scopeValue)`. Operates at the entity (scopeValue) level despite
  the substrate SDK method being named `ExpireDroplet`. Marks the
  entity (all revision droplets, floats, embedding-index entries)
  for S3 lifecycle deletion; vector cleanup cascades. Capability
  op: `expire` -- destructive, distinct from `write` per audit
  §M. A bolt declaring `expire` explicitly opts into "I may
  retire my own data."
- **`db.expirationDays`** -- audit §M (Gap 8).
  `ctx.db.expirationDays()` (takes NO args -- the value is
  tenant-wide, not per-formation/per-scope per substrate brain
  doc Q4). Returns the tenant's retention window in days; 0
  means no retention rule. No capability gate (metadata access).
- **`db.writeBatch`** -- audit §I (Gap 4).
  `ctx.db.writeBatch(formationId, items, opts?)`. SINGLE
  formation per call (matches SDK reality per substrate brain
  doc Q5; cross-formation writes require multiple writeBatch
  calls). Capability op: `write` on the formation -- one OpWrite
  check covers the whole batch. Partial-success contract: items
  may individually succeed or fail; inspect `result.items[i].error`
  to discriminate. The result shape mirrors the substrate's
  `batchResultToJS` projection (`{total, succeeded, failed,
  items: BatchItemResult[]}`).
- **`schedule.schedule`** -- Wave 2.5 actions precursor.
  `ctx.schedule(formationId, runAfterMs, actionRef, payload?)`.
  Returns the substrate-minted scheduled event's S3 key for
  future cancellation (cancellation API is a v0.2 substrate
  follow-up). Capability op: bolt-level `OpSchedule` -- single
  boolean opt-in on `capabilities.raindb.schedule: true`. Distinct
  from formation-level read/write because the schedule's target
  is supplied at call time and the eventual callback runs in a
  separate invocation context.

### Shape divergences from v0.1 stubs

The substrate's actual contract differed from four v0.1 stub
shapes; the substrate wins per the handoff's "bolt-sdk's role is
to mirror the substrate; it doesn't drive shape decisions"
discipline:

1. **Tags are `Record<string, string>`** (S3 tag key=value
   pairs), NOT `string[]`. The v0.1 stub `TagInput` typed `tags`
   as `string[]`; the substrate's `TagEntity` takes a
   `map[string]string` per `SDKDatabase.TagEntity`. Bolts that
   had imported the v0.1 type (which threw `BindingNotInstalled`
   at runtime, so consumers are rare) need to switch from
   `['a', 'b']` to `{ a: 'true', b: 'true' }` (or whatever
   key=value mapping fits).

2. **`db.untag` takes a `tagKeys: string[]`** -- the list of KEY
   names to remove, not values. The v0.1 stub re-used `TagInput`
   (with its incorrect `string[]` shape) for both add and remove
   paths, which couldn't distinguish "add these tag values" from
   "remove these tag keys." The new `UntagInput` shape makes the
   distinction explicit.

3. **`db.expire` operates on `{formationId, scopeValue}`**, not
   `{formationId, dropletId}`. The substrate's `ExpireDroplet`
   method (despite its name) flags ALL droplet revisions, floats,
   and embedding-index entries for the entity keyed by
   `(formationId, scopeValue)`. The v0.1 `ExpireInput` typed
   `dropletId` which did not correspond to anything the substrate
   produces. See substrate brain doc Q3.

4. **`db.expirationDays` takes NO arguments** and returns the
   tenant-wide value. The v0.1 stub typed
   `{formationId, scopeValue}`; the substrate's
   `Client.ExpirationDays()` is a tenant-scoped accessor per
   substrate brain doc Q4. The v0.1 `ExpirationDaysInput` type is
   REMOVED from the public surface.

5. **`db.writeBatch` is single-formation**: input shape changed
   from `{items: [{formationId, payload}, ...]}` (cross-formation)
   to `{formationId, items: [{payload, idempotencyKey?}, ...],
   opts?}` (single formation, per-item idempotency). The result
   shape changed from `{writes, bulkResults, idempotencyHit}` to
   the substrate's `batchResultToJS` projection
   (`{total, succeeded, failed, items: BatchItemResult[]}`). Per
   substrate brain doc Q5, cross-formation in one call isn't in
   scope because the SDK's `WriteBatch` signature doesn't support
   it.

### Stayed STUBBED

- **`tags.replaceTags`** -- the substrate did NOT ship an atomic
  replace binding. The SDK exposes `TagEntity` (additive) and
  `UntagEntity` (key-removal) only. The wrapper continues to
  throw `BindingNotInstalled` on call. Bolts that don't need
  atomicity can emulate via:
  ```ts
  await db.untag({ formationId, scopeValue, tagKeys: oldKeysToRemove });
  await db.tag({ formationId, scopeValue, tags: newTagSet });
  ```
  (Non-atomic; brief window where the entity has neither the old
  nor the new tag set.)

### Added

- **`src/bindings/schedule.ts`** -- new file. `schedule.schedule()`
  wrapper plus `ScheduleBinding` / `ScheduleInput` types.
- **`db.tag` / `db.untag` methods** on the canonical `db` namespace
  (in addition to the ergonomic `tags.tag` / `tags.untag` 3-arg
  re-routes).
- **`BatchItemResult`** type in `src/bindings/db.ts` -- the
  per-item entry of `WriteBatchResult.items`.
- **`WriteBatchOpts`** type -- the new shape for the batch-level
  options object (`idempotencyKey`, `triggerFlows`,
  `maxConcurrency`).
- **`TagInput`** / **`UntagInput`** types on the canonical `db`
  namespace.
- **`BoltContext.schedule?: ScheduleBinding`** optional property.
  Marked optional for backwards-compat with older lightning
  binaries (pre-f934956); the wrapper guards with
  `BindingNotInstalled`.
- **`BINDING.db_tag`** / **`BINDING.db_untag`** / **`BINDING.schedule`**
  constants in `src/internal/constants.ts`.
- **Four new example-bolt handlers** under
  `test/integration/example-bolt/src/handlers/`:
  - `tag-roundtrip.ts` -- tag (additive), tag again, untag,
    invoke replaceTags STUB
  - `expire-droplet.ts` -- read expirationDays, expire entity
  - `write-batch.ts` -- 3-item batch with per-item + batch-level
    idempotency keys, partial-success discrimination
  - `schedule-callback.ts` -- enqueue a 60s-deferred bolt-callback
  Plus `bolt.json` updates declaring `tag`, `expire` ops on the
  `agent-graph` formation and the bolt-level
  `capabilities.raindb.schedule: true` opt-in.
- **23 new unit tests** in `test/unit/v0_3-tier-2-swap.test.ts`
  covering happy-path, capability-denial (formation-shape for
  db.* / bolt-shape for schedule.*), and binding-missing paths
  for each newly-LIVE wrapper. Combined with the v0.1+v0.2 tests,
  the package now ships with 107 unit tests (all green).

### Changed

- **`DbBinding.tag` / `untag` / `expire` / `expirationDays` /
  `writeBatch`** methods added to the raw goja-side type with
  positional-args signatures matching the substrate's installer
  conventions. All five methods are typed optional (the `?`)
  for backwards-compat with older lightning binaries; the SDK
  wrapper guards with `BindingNotInstalled` rather than
  crashing.
- `BoltContext.tags?: TagsBinding` documentation updated -- the
  substrate does NOT install a `ctx.tags` namespace. The SDK
  wrapper `tags.tag` / `tags.untag` re-routes through `ctx.db.tag`
  / `ctx.db.untag`. The type field stays declared for
  backwards-import-compat with v0.1 type consumers.
- Package `version` bumped from `0.2.0` to `0.3.0`. `VERSION`
  constant in `src/index.ts` updated to match.

### Notes for the next agent

- The five db.* / schedule.* bindings flipped from `STUB` to
  `LIVE-SINCE-v0.3.0` in
  `~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md`.
- The example-bolt's `bolt.json` declares two new formation ops
  (`tag`, `expire` on `agent-graph`) and one new bolt-level cap
  (`schedule: true`). The substrate-side manifest validator
  should accept both (`OpTag` + `OpExpire` are in
  `AllowedFormationOps`; `OpSchedule` is in
  `AllowedBoltLevelOps`). If validation fails, coordinate with
  the substrate-side agent.
- `ctx.schedule` capability denials surface as plain
  `RainDBBoltError` (not `CapabilityDenied`) because the
  substrate's denial format (`schedule capability not declared`)
  is bolt-level, NOT formation-shape, and does not match
  `CAPABILITY_DENIAL_REGEX`. This is by design; bolts that want
  to discriminate can pattern-match on `e.message`. See open
  question 7 in the handoff doc for the regex-tolerance
  conversation.
- `tags.replaceTags` stays STUBBED -- the substrate did not ship
  an atomic replace. If a future substrate work item adds one,
  swap the stub then; otherwise, document the
  untag-then-tag emulation pattern in any v0.4 handoff.

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
[0.3.0]: https://github.com/gignit/raindb-bolt-sdk-ts/releases/tag/v0.3.0
