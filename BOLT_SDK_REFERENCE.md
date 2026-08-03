# RainDB Bolt SDK Reference

The complete, fact-based reference for the `ctx.*` surface a tenant's
Lightning bolt uses. Every signature is cited from source. Nothing here
is guessed; where a fact is uncertain in the source it is flagged.

> Package version: `0.6.0` (`src/index.ts:18`).

---

## 1. Overview

### What a bolt is

A **bolt** is a tenant's server-side handler run inside RainDB Lightning.
The canonical entrypoint is an `onHttpRequest(ctx, req)` function that
returns a `BoltResponse`:

```ts
import { setCtx, db, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);                       // MUST be the first line of every handler
  const id = req.params['id'];
  const droplet = await db.readLatest({
    formationId: 'agent-graph',
    indexId: 'by-id',
    scopeValue: id ?? '',
  });
  return { status: 200, body: droplet ?? { error: 'not found' } };
}
```

- The handler signature and `setCtx(ctx)` requirement come from
  `src/types/bolt-context.ts:76-91` and `src/runtime/ctx-resolver.ts:56-78`.
- `setCtx(ctx)` registers the ambient context once; every `db.*`,
  `auth.*`, etc. call resolves through it (`src/runtime/ctx-resolver.ts`).
  Not calling `setCtx` throws `RainDBBoltError("setCtx(ctx) was not
  called on this invocation.")` on the first binding call
  (`src/runtime/ctx-resolver.ts:69-77`).

### The two engines

A bolt is **written once against the `@raindb/bolt-sdk` TypeScript
wrapper and runs UNCHANGED on either engine:**

1. **goja (in-process)** — a Go-embedded JS runtime. Bindings installed
   in `pkg/lightning/engines/goja/bindings.go`; `ctx`/`req` built in
   `pkg/lightning/engines/goja/sandbox.go`. Single-use sandbox per
   invocation, no event loop (`sandbox.go:18`, `:286-302`).
2. **nodejs-20 pod (out-of-process)** — a vanilla Node container. The
   bolt's `ctx` is built by
   `raindb-lightning-pods/sdk-clients/nodejs/index.js::makeCtx`, whose
   methods call back to the host over a Unix-domain-socket channel
   (length-prefixed JSON frames) dispatched by
   `internal/lightning/podchannel/dispatch.go`.

### Write-once, run-either-engine contract

The TS wrapper (`src/bindings/*.ts`) is the **author-facing contract**.
Each wrapper takes a named-args object, repacks it into the raw goja
positional calling convention, and throws typed errors. The raw `ctx`
that both engines expose is positional and identical in shape; the
wrapper is what the author codes against.

### Async vs. sync

`ctx.*` methods are **async (Promise-returning)** except pure-local
ones. Specifically:

- **Sync (no channel round-trip / no I/O):**
  - `ctx.ids.uuidv7()` — returns a `string` directly
    (`src/bindings/ids.ts:30-33`; goja `bindings.go:962-964`; node
    `index.js:447-449`).
  - `ctx.auth.tenantId` / `.subject` / `.apiClientId` / `.isAnonymous`
    — scalar property reads (`src/bindings/auth.ts:163-199`).
  - `ctx.auth.permits(...)` / `.permitsWireKeySubscribe(...)` —
    **synchronous booleans by design** (see §4).
  - `ctx.log.{info,warn,error}` — fire-and-forget, return `void`
    (`src/bindings/log.ts:49-64`).
- **Async everywhere else** — the wrapper `await`s the raw binding. On
  the pod these are genuine channel round-trips; on goja they are
  in-process but the wrapper contract is still `Promise`-returning.
  `ctx.cookies.{parse,build}` are pure-local on both engines but the
  wrapper still exposes them as `async` for a uniform surface
  (`src/bindings/cookies.ts:48,78`).

---

## 2. The `ctx` object

`BoltContext` (`src/types/bolt-context.ts:93-161`) composes every
namespace below. LIVE namespaces are installed by the substrate today;
STUB namespaces have a typed wrapper but throw `BindingNotInstalled`
until the substrate ships them.

**Namespace summary (23 namespaces + `ctx.bolt`/`ctx.trigger` metadata):**

| Namespace | Status | Methods | Source (wrapper) |
| --- | --- | --- | --- |
| `ctx.db` | LIVE | 17 | `src/bindings/db.ts` |
| `ctx.auth` | LIVE (v0.4.0) | 4 scalars + 2 predicates | `src/bindings/auth.ts` |
| `ctx.objects` | LIVE (v0.2.0) | 4 | `src/bindings/objects.ts` |
| `ctx.sql` | LIVE (v0.2.0) | 1 | `src/bindings/sql.ts` |
| `ctx.iam` | LIVE | 1 | `src/bindings/iam.ts` |
| `ctx.secrets` | LIVE | 1 | `src/bindings/secrets.ts` |
| `ctx.crypto` | LIVE | 3 | `src/bindings/crypto.ts` |
| `ctx.jwt` | LIVE | 2 | `src/bindings/jwt.ts` |
| `ctx.cookies` | LIVE | 2 | `src/bindings/cookies.ts` |
| `ctx.ids` | LIVE | 1 | `src/bindings/ids.ts` |
| `ctx.fetch` | LIVE | callable | `src/bindings/fetch.ts` |
| `ctx.log` | LIVE | 3 | `src/bindings/log.ts` |
| `ctx.schedule` | LIVE (v0.3.0) | callable | `src/bindings/schedule.ts` |
| `ctx.response` | LIVE (streaming routes only) | 3 | `src/bindings/response.ts` |
| `ctx.tags` | LIVE (tag/untag) + STUB (replaceTags) | 3 | `src/bindings/tags.ts` |
| `ctx.token` | STUB | 5 | `src/bindings/token.ts` |
| `ctx.stats` | STUB | 4 | `src/bindings/stats.ts` |
| `ctx.relay` | STUB (contract-uncertain) | 7 | `src/bindings/relay.ts` |
| `ctx.actions` | STUB | 2 | `src/bindings/actions.ts` |
| `ctx.vectors` | STUB (contract-uncertain) | 3 | `src/bindings/vectors.ts` |
| `ctx.files` | STUB | 4 | `src/bindings/files.ts` |
| `ctx.catalog` | STUB (contract-uncertain) | 6 | `src/bindings/catalog.ts` |
| `ctx.formations` | STUB | 3 | `src/bindings/formations.ts` |
| `ctx.flows` | STUB | 1 | `src/bindings/flows.ts` |
| `ctx.bolt` | LIVE metadata | — | `src/types/bolt-context.ts:56-67` |
| `ctx.trigger` | LIVE (non-HTTP invocations only) | — | `src/types/bolt-context.ts:193-198` |

> A convention note that recurs below: **the wrapper takes a
> `{formationId, ...}` named-args object; the raw goja binding is
> positional** (e.g. `readLatest(formationId, indexId, scopeValue)`).
> Where the raw binding differs materially it is noted per method.

---

### 2.1 `ctx.db` — droplet, index, token, and mutation surface

Wrapper: `src/bindings/db.ts`. Raw goja installer:
`bindings.go::installDBBinding` (`bindings.go:46-341`). Pod dispatch:
`dispatch.go` handlers; pod client: `index.js:191-319`.

All wrapper methods return `Promise`. Return-shape citations refer to
`src/types/droplet.ts`.

#### `readLatest(input: ReadLatestInput): Promise<Droplet | null>`
- `src/bindings/db.ts:523-538`.
- `ReadLatestInput = { formationId: string; indexId: string; scopeValue: string }`
  (`db.ts:57-61`).
- Raw goja: `readLatest(formationId, indexId, scopeValue)` (positional;
  `bindings.go:53-65`). Pod: `OpDBReadLatest`, host wraps `{row}`,
  node unwraps `.row ?? null` (`dispatch.go:138-153`, `index.js:192-193`).
- Returns the droplet or `null` when no pointer exists.
- Requires capability `read` on the formation (`db.ts:508`).
- **The default id index is `by-id`** (NOT the retired `by-id-latest`)
  — `db.ts:96-99`, `db.ts:517`.

#### `readDroplet(input: ReadDropletInput): Promise<Droplet | null>`
- `db.ts:558-569`. `ReadDropletInput = { formationId; dropletId }` (`db.ts:63-66`).
- Raw goja: `readDroplet(formationId, dropletId)` (`bindings.go:67-78`).
  Pod: `OpDBReadDroplet` → `{row}` unwrapped (`dispatch.go:155-169`,
  `index.js:194-195`).
- Reads a specific revision by ID rather than the current pointer.
  Requires `read`.

#### `writeDroplet(input: WriteDropletInput): Promise<DropletEnvelope>`
- `db.ts:592-609`. `WriteDropletInput = { formationId; payload: Record<string, unknown> }`
  (`db.ts:68-71`).
- Raw goja: `writeDroplet(formationId, payload)` → `{ dropletId }`
  (`bindings.go:80-96`). Pod: `OpDBWriteDroplet` → `{ dropletId }`
  (`dispatch.go:171-185`, `index.js:196-200`).
- `DropletEnvelope = { dropletId: string }` (`droplet.ts:52-54`). The
  wrapper throws a plain `Error` if the substrate did not return a
  `dropletId` string (`db.ts:597-601`).
- Requires `write`; throws `ConditionFailed` on unsatisfied CAS controls.

#### `listDroplets(input: ListDropletsInput): Promise<DropletsPage>`
- `db.ts:635-657`.
- `ListDropletsInput = { formationId; opts?: CursorPaginationOpts; pageSize?: number (deprecated); prefix?: string (deprecated) }`
  (`db.ts:73-89`).
- **Returns a PAGE, not a bare array.** `DropletsPage = { droplets: Droplet[]; nextCursor?: string | null; hasMore: boolean }`
  (`droplet.ts:146-150`). This is the substrate H12 fix — previously it
  returned a bare array and dropped the cursor (`db.ts:76-82`).
- Raw goja: `listDroplets(formationId, opts?)` where opts is
  `{first, after, prefix}` (`bindings.go:105-119`). Pod: `OpDBListDroplets`
  → host wraps `{page}`; node maps PascalCase Go JSON
  (`Droplets/NextCursor/HasMore`) to lowercase (`dispatch.go:187-205`,
  `index.js:209-221`).
- Requires `list`.
- Pagination walk example (`db.ts:622-633`): loop reading
  `page.droplets`, break on `!page.hasMore`, carry `page.nextCursor`.

#### `listKeys(input: ListKeysInput): Promise<KeyPage>`
- LIVE since v0.2.0. `db.ts:699-725`.
- `ListKeysInput = { formationId; indexId: string; opts?: CursorPaginationOpts }`
  (`db.ts:91-101`). `indexId` is required; a name the formation does not
  declare returns 404 index-not-found (`db.ts:93-99`).
- **Keys-only index walk** (no droplet payloads). `KeyPage = { keys: KeyEntry[]; nextCursor?: string | null; hasMore: boolean; totalCount: number }`
  (`droplet.ts:109-114`); `KeyEntry = { key; size; lastModified; etag? }`
  (`droplet.ts:93-103`).
- Raw goja: `listKeys(formationId, indexId, opts?)` (`bindings.go:123-138`).
  Pod: `OpDBListKeys` → host `{page}`; node maps PascalCase entries
  (`dispatch.go:210-231`, `index.js:227-249`).
- The wrapper guards `typeof ctx.db.listKeys !== 'function'` and throws
  `BindingNotInstalled` on older lightning binaries (`db.ts:701-711`).
- Requires `list`.

#### `listSince(input: ListSinceInput): Promise<SincePage>`
- LIVE since v0.2.0. `db.ts:759-785`.
- `ListSinceInput = { formationId; sinceCursor: string; opts?: CursorPaginationOpts }`
  (`db.ts:103-113`). `sinceCursor` is an opaque cursor from a prior
  `nextCursor`, or `''` for "from the beginning."
- **Returns FULL droplet payloads** (asc-poll live-feed over the
  `by-update` index). `SincePage = { droplets: Droplet[]; nextCursor?: string | null; hasMore: boolean }`
  (`droplet.ts:128-132`). NOTE: v0.1 stub mistyped this as `KeyPage`;
  corrected to `SincePage` (`droplet.ts:124-127`).
- Raw goja: `listSince(formationId, sinceCursor, opts?)`; an
  undefined/null cursor means "from the beginning", not the literal
  string `"undefined"` (`bindings.go:141-162`). Pod: `OpDBListSince`,
  host returns the goja shape directly, no remap
  (`dispatch.go:552-581`, `index.js:253-259`).
- Guards + `BindingNotInstalled` like listKeys (`db.ts:761-771`).
  Requires `list`.

#### `tag(input: TagInput): Promise<void>`
- LIVE since v0.3.0. `db.ts:811-832`.
- `TagInput = { formationId; scopeValue; tags: Record<string, string> }`
  (`db.ts:242-246`). **Tags are `Record<string,string>` S3 key=value
  pairs** (v0.1 stub used `string[]` — incorrect). Additive semantics.
- Raw goja: `tag(formationId, scopeValue, tags)` →
  `db.TagEntity(...)`; goja rejects non-string tag values
  (`bindings.go:169-183`, `extractTagsMap` `:347-375`). Pod: `OpDBTag`
  (`dispatch.go:668-693`, `index.js:277-279`).
- Requires the NEW canonical `tag` op (distinct from `write`) — `db.ts:795`,
  substrate `OpTag = "tag"` (`engine.go:560`).

#### `untag(input: UntagInput): Promise<void>`
- LIVE since v0.3.0. `db.ts:853-874`.
- `UntagInput = { formationId; scopeValue; tagKeys: string[] }` — `tagKeys`
  is a list of KEY names to remove (not values) (`db.ts:254-258`).
  Idempotent.
- Raw goja: `untag(formationId, scopeValue, tagKeys)` (`bindings.go:187-201`).
  Pod: `OpDBUntag` (`dispatch.go:698-723`, `index.js:283-285`). Requires `tag`.

#### `writeBatch(input: WriteBatchInput): Promise<WriteBatchResult>`
- LIVE since v0.3.0. `db.ts:915-941`.
- `WriteBatchInput = { formationId; items: WriteBatchItem[]; opts?: WriteBatchOpts }`
  (`db.ts:164-169`). Single formation per call (substrate constraint).
- `WriteBatchItem = { payload: Record<string, unknown>; idempotencyKey? }`
  (`db.ts:125-128`).
- `WriteBatchOpts = { idempotencyKey?; triggerFlows?; maxConcurrency? }`
  (`db.ts:138-157`). `triggerFlows` defaults to `true` substrate-side
  (`bindings.go:251`).
- `WriteBatchResult = { total; succeeded; failed; items: BatchItemResult[] }`
  (`db.ts:198-203`). `BatchItemResult = { index; pathsWritten; dropletId?; scopeValue?; error? }`
  (`db.ts:181-190`). **Partial success is the contract** — `failed > 0`
  does NOT mean the whole call rejected; discriminate per item on
  `.error` (`db.ts:181-190`, `bindings.go:530-562`).
- Raw goja: `writeBatch(formationId, items, opts?)` (`bindings.go:238-261`).
  Pod: `OpDBWriteBatch` (`dispatch.go:587-653`, `index.js:264-268`).
  Requires `write`.

#### `mutate(input: MutateInput): Promise<void>`
- LIVE (v0.5.0). `db.ts:1125-1146`.
- `MutateInput = { formationId; scopeValue; ops: JsonOp[] }` (`db.ts:329-333`).
- Atomic read-modify-write on a cache-backed token entity (the owning
  formation must declare `lifecycle.autoCache: true`). Applies ops under
  the host entry mutex.
- Raw goja: `mutate(formationId, scopeValue, ops)` (`bindings.go:272-286`).
  Pod: `OpDBMutate` (`dispatch.go:772-789`, `index.js:297-299`).
- Requires the `mutate` op (distinct from `write`) — `db.ts:1112`,
  substrate `OpMutate = "mutate"` (`engine.go:584`).

#### `mutateAndRead(input: MutateAndReadInput): Promise<Record<string, number>>`
- LIVE (v0.5.0). `db.ts:1185-1214`.
- `MutateAndReadInput = { formationId; scopeValue; ops: JsonOp[]; readPaths: string[] }`
  (`db.ts:336-346`). Each `readPath` maps to its post-mutation int64
  value in the returned record (substrate stamps the `payload.` prefix).
- Raw goja: `mutateAndRead(formationId, scopeValue, ops, readPaths)`
  returning `{path: value}` directly (`bindings.go:294-317`). Pod:
  `OpDBMutateAndRead` — **host wraps `{values}`; node client unwraps
  `.values` to match the goja direct-return shape** (`dispatch.go:795-829`,
  `index.js:307-312`). Requires `mutate`.

#### `writeToken(input: WriteTokenDbInput): Promise<DropletEnvelope>`
- LIVE (v0.5.0). `db.ts:1240-1268`.
- `WriteTokenDbInput = { formationId; payload: Record<string, unknown> }`
  (`db.ts:354-357`). Named to disambiguate from `ctx.token.write`'s
  `WriteTokenInput` — this writes a token DROPLET to a token formation.
- Raw goja: `writeToken(formationId, payload)` → `{ dropletId }`; the
  substrate stamps author `bolt:<boltId>` (`bindings.go:322-338`). Pod:
  `OpDBWriteToken` (`dispatch.go:835-849`, `index.js:317-318`).
- Requires the `token-write` op (`db.ts:1225`, `engine.go:548`).

#### `expire(input: ExpireInput): Promise<void>`
- LIVE since v0.3.0. `db.ts:1024-1045`.
- `ExpireInput = { formationId; scopeValue }` (`db.ts:227-230`).
  **Operates at the ENTITY (scopeValue) level despite the substrate
  method name `ExpireDroplet`** (v0.1 stub had `dropletId` — incorrect)
  (`db.ts:1009-1013`).
- Raw goja: `expire(formationId, scopeValue)` (`bindings.go:207-217`).
  Pod: `OpDBExpire` (`dispatch.go:730-743`, `index.js:289-291`).
- Requires the destructive `expire` op (distinct from `write`) —
  `db.ts:1015`, `engine.go:569`.

#### `expirationDays(): Promise<number>`
- LIVE since v0.3.0. `db.ts:1069-1094`.
- **Takes NO arguments** — tenant-wide value (v0.1 stub took
  `{formationId, scopeValue}` — incorrect) (`db.ts:1053-1057`). Returns
  `0` when no retention rule is configured. No capability gate.
- Raw goja returns a synchronous value; the wrapper `Promise.resolve`-
  normalizes so it stays awaitable (`bindings.go:223-225`, `db.ts:1083-1088`).
  Pod: `OpDBExpirationDays` → host `{days}`, node unwraps `.days`
  (`dispatch.go:658-660`, `index.js:270-271`).

#### JSON-op wire shapes (for `mutate` / `mutateAndRead`)
Discriminated union `JsonOp` (`db.ts:322-326`); the wrapper passes them
through unchanged and the host decodes via `storage.DecodeJSONOps`:

- `JsonOpIncrement = { kind: 'increment'; path: string; by: number }` (`db.ts:275-279`).
- `JsonOpSet = { kind: 'set'; path: string; value: unknown }` (`db.ts:282-286`).
- `JsonOpMove = { kind: 'move'; from: string; to: string; reset?: boolean }` (`db.ts:292-297`).
- `JsonOpWindowIncrement = { kind: 'windowIncrement'; countPath; windowStartPath; windowMs; by; nowMs }`
  (`db.ts:309-316`) — the passive fixed-window INCR+EXPIRE primitive
  (monthly quota reset with no cron).

#### STUBBED `ctx.db` methods (throw `BindingNotInstalled`)
- `readAt(input: ReadAtInput): Promise<Droplet | null>` —
  `ReadAtInput = { formationId; scopeValue; asOf: string }` (ISO ts or
  UUIDv7). `db.ts:205-210`, `db.ts:950-958`.
- `readCurrent(input: ReadCurrentInput): Promise<Droplet | null>` —
  `{ formationId; scopeValue }`. Shorthand for readLatest with `by-id`.
  `db.ts:212-215`, `db.ts:967-976`.
- `resolveFormation(dropletId: string): Promise<string | null>` —
  `db.ts:986-994`.

---

### 2.2 `ctx.auth` — per-request authentication surface

LIVE since v0.4.0. Wrapper `src/bindings/auth.ts`; raw goja
`bindings.go::installAuthBinding` (`:1256-1292`); pod
`index.js::makeAuth` (`:498-511`).

**IMPORTANT — absent-`ctx.auth` defaults:** the wrapper reads `ctx.auth`
through `resolveCtx()` and returns safe defaults when `ctx.auth ===
undefined` (older lightning binaries, pre-7bf58b6). The scalar getters
return `''`; `isAnonymous` returns `true`; both predicates return
`false` (`auth.ts:163-225`).

Scalars (property getters, sync):

- `get tenantId(): string` — the USER's tenant, where their data lives.
  For portal bolts this is NOT the bolt's host tenant (that is on
  `ctx.bolt.tenantId`). `auth.ts:163-167`, raw `bindings.go:1266`.
- `get subject(): string` — `Grant.Subject` (end-user userId). `auth.ts:172-176`.
- `get apiClientId(): string` — `Grant.JTI` (credential id). `auth.ts:181-185`.
- `get isAnonymous(): boolean` — true when no credential presented.
  `auth.ts:195-199`.

Predicates (**synchronous booleans, no I/O — by design; see §4**):

- `permits(resourceType: string, resourceID: string, op: string): boolean`
  — same semantics as GraphQL's `RequireResource` and pkg/auth's
  `ResourceGrant.Permits`. `auth.ts:211-215`, raw `bindings.go:1272-1280`.
- `permitsWireKeySubscribe(resourceID: string): boolean` — the canonical
  3-rule check (`wire-key:subscribe` OR `formation:read` OR
  `tenant:admin`). `auth.ts:221-225`, raw `bindings.go:1283-1289`.

---

### 2.3 `ctx.objects` — bucket blob store

LIVE since v0.2.0. Wrapper `src/bindings/objects.ts`; raw goja
`bindings.go::installObjectsBinding` (`:671-754`); pod
`dispatch.go` `OpObjects*` + `index.js:324-344`.

**Relative-key contract:** keys must be RELATIVE; the substrate rejects
absolute keys (per the objects capability model; the wrapper passes
positional `(bucket, key, ...)` through unchanged).

- `get(bucket: string, key: string): Promise<string>` — returns object
  bytes **as a string** (goja surfaces bytes as a JS string; on the pod
  the channel carries base64 and the node client decodes to a string).
  `objects.ts:117-131`, raw `bindings.go:678-694`, pod `dispatch.go:235-249` +
  `index.js:325-335`. Requires `object-read`.
- `put(bucket: string, key: string, data: Uint8Array | string, contentType?: string): Promise<void>`
  — `objects.ts:159-177`, raw `bindings.go:696-726`, pod `index.js:336-340`.
  Requires `object-write`.
- `exists(bucket: string, key: string): Promise<boolean>` —
  `objects.ts:196-210`, raw `bindings.go:728-739`. Requires `object-read`.
- `delete(bucket: string, key: string): Promise<void>` — idempotent
  substrate-side. `objects.ts:227-240`, raw `bindings.go:741-751`.
  Requires `object-write`.

The wrapper throws `BindingNotInstalled` when `ctx.objects === undefined`
(`objects.ts::missingObjects` `:66-77`).

---

### 2.4 `ctx.sql` — analytical query plane (DuckDB / periscope)

LIVE since v0.2.0. Wrapper `src/bindings/sql.ts`; raw goja
`bindings.go::installSQLBinding` (`:772-796`); pod `OpSQLQuery`
(`dispatch.go:304-325`, `index.js:320-323`).

- `query(input: SqlQueryInput): Promise<SqlResult>` — `sql.ts:213-234`.
- `SqlQueryInput = { sql: string; formationId?: string; timeoutMs?: number; withFreshness?: boolean }`
  (`sql.ts:51-75`). Wrapper repacks into positional `(sql, opts)`.
- `SqlResult = { columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number; durationMs: number; truncated: boolean; latest?: SqlFreshnessRow[] }`
  (`sql.ts:115-132`). **`rows` are column-keyed objects** — read
  `row[column]` — IDENTICAL to the GraphQL `executeSQL` shape
  (`sql.ts:104-113`).
- `SqlFreshnessRow = { formationId; snapshotCursor; currentLatest; stale }`
  (`sql.ts:83-101`). Currently the Tier-1 substrate cut returns `latest`
  only when non-empty; `withFreshness: true` still yields nil latest
  (deferred) — `sql.ts:126-131`, host `sqlResultToJS` `:823-853`.
- Requires bolt-level `sql-read` (`capabilities.raindb.sqlRead: true`,
  `engine.go:596`). Throws `BindingNotInstalled` when `ctx.sql ===
  undefined` (`sql.ts::missingSql` `:153-164`).

---

### 2.5 `ctx.iam` — wire-token minting

LIVE. Wrapper `src/bindings/iam.ts`; raw goja
`bindings.go::installIAMBinding` (`:1162-1232`); pod `OpIAMMintWireToken`
(`dispatch.go:507-545`, `index.js:406-416`).

- `mintWireToken(opts: WireTokenMintOptions): Promise<string>` — returns
  the signed `rgr1.<...>` token string. `iam.ts:80-90`.
- `WireTokenMintOptions = { subject: string; resources: WireTokenResource[]; ttlSec?: number }`
  (`iam.ts:30-37`). Substrate default `ttlSec` 3600, max 86400.
- `WireTokenResource = { type: 'wire-key' | string; id: string; ops: string[] }`
  (`iam.ts:17-24`). The substrate validates subject non-empty, resources
  non-empty, each `id` prefixed `tenants/<bolt tenantId>/`, and TTL
  bounds; failures throw `RainDBBoltError`.

---

### 2.6 `ctx.secrets`

LIVE. `src/bindings/secrets.ts`; raw goja `bindings.go::installSecretsBinding`
(`:935-953`); pod `OpSecretsGet` (`dispatch.go:329-339`, `index.js:345-347`).

- `get(name: string): Promise<string>` — `secrets.ts:38-49`. The name
  MUST be in `capabilities.raindb.secrets.names`; an undeclared name
  surfaces as a generic `RainDBBoltError`.

---

### 2.7 `ctx.crypto`

LIVE. `src/bindings/crypto.ts`; raw goja `bindings.go::installCryptoBinding`
(`:1012-1060`); pod `OpCrypto*` (`dispatch.go:419-459`, `index.js:367-383`).
Routes through the host (bcrypt + crypto/rand) so results are byte-
identical across engines.

- `hashPassword(plaintext: string, cost?: number): Promise<string>` —
  bcrypt; default cost 10 when omitted/≤0. `crypto.ts:42-55`, raw `bindings.go:1019-1033`.
- `verifyPassword(plaintext: string, hash: string): Promise<boolean>` —
  **returns a boolean; mismatch is a normal `false`, not a throw**
  (`crypto.ts:69-80`, raw `bindings.go:1035-1045`, pod `dispatch.go:436-447`).
- `randomBytes(n?: number): Promise<string>` — hex-encoded; default 32
  bytes. `crypto.ts:94-107`, raw `bindings.go:1047-1057`.

---

### 2.8 `ctx.jwt`

LIVE. `src/bindings/jwt.ts`; raw goja `bindings.go::installJWTBinding`
(`:969-1009`); pod `OpJWTSign/Verify` (`dispatch.go:464-498`, `index.js:389-398`).
HS256; secret resolved by name from the bolt's secrets.

- `sign(secretName: string, claims: JwtClaims, expiresInSec: number): Promise<string>`
  — standard claims (iat/iss/aud) populated when absent; `exp` from
  `expiresInSec`. `jwt.ts:53-67`, raw `bindings.go:976-993`.
- `verify(secretName: string, token: string): Promise<JwtClaims>` —
  validates `exp`/`nbf`; throws `RainDBBoltError` on mismatch/expiry.
  `jwt.ts:87-97`, raw `bindings.go:995-1006`.
- `JwtClaims = Record<string, unknown>` (`jwt.ts:16`).

---

### 2.9 `ctx.cookies`

LIVE. `src/bindings/cookies.ts`; raw goja `bindings.go::installCookiesBinding`
(`:1063-1115`). Pure-local on the pod (no channel round-trip;
`index.js:453-477`), but the wrapper is `async`.

- `parse(headerValue: string): Promise<Record<string, string>>` —
  RFC 6265 parse to a name→value map. `cookies.ts:48-59`.
- `build(name: string, value: string, opts?: CookieOptions): Promise<string>`
  — `cookies.ts:78-93`. `CookieOptions = { path?; domain?; maxAge?; httpOnly?; secure?; sameSite?: 'Strict' | 'Lax' | 'None' }`
  (`cookies.ts:14-22`). `maxAge` semantics: `<0` delete, `0` session.

---

### 2.10 `ctx.ids`

LIVE. `src/bindings/ids.ts`; raw goja `bindings.go::installIDsBinding`
(`:956-966`); pod local generation (`index.js:447-449`).

- `uuidv7(): string` — **synchronous, no error path** (`ids.ts:30-33`).
  Time-sortable; the substrate's canonical droplet identifier shape.

---

### 2.11 `ctx.fetch`

LIVE. The binding is a **callable** (not a namespace). Wrapper
`src/bindings/fetch.ts`; raw goja `bindings.go::installFetchBinding`
(`:856-932`); pod `OpFetchDo` (`dispatch.go:343-378`, `index.js:417-439`).

- `fetch(url: string, init?: FetchInit): Promise<FetchResponse>` —
  `fetch.ts:75-89`.
- `FetchInit = { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }`
  (`fetch.ts:28-32`).
- `FetchResponse = { status: number; ok: boolean; headers: Record<string, string | string[]>; body: string; text(): Promise<string> | string; json(): Promise<unknown> | unknown }`
  (`fetch.ts:39-46`). `ok` is `status >= 200 && status < 300`
  (`bindings.go:917`, `index.js:433`); `body` is a string.
- **Egress-allowlisted:** the target host MUST be in
  `capabilities.network.egress[]`; non-allowlisted hosts reject as a
  generic `RainDBBoltError` (`fetch.ts:13-18`).

---

### 2.12 `ctx.log`

LIVE. `src/bindings/log.ts`; raw goja `bindings.go::installLogBinding`
(`:14-38`); pod maps to `console.*` (`index.js:440-444`).

- `info(msg: string, fields?: Record<string, unknown>): void` (`log.ts:50-54`).
- `warn(msg: string, fields?: Record<string, unknown>): void` (`log.ts:55-59`).
- `error(msg: string, fields?: Record<string, unknown>): void` (`log.ts:60-64`).

Fire-and-forget; return `void`; errors swallowed (`log.ts:26-32`).

---

### 2.13 `ctx.schedule` — deferred bolt callback

LIVE since v0.3.0. The binding is a **top-level callable**. Wrapper
`src/bindings/schedule.ts`; raw goja `bindings.go::installScheduleBinding`
(`:1315-1350`); pod `OpSchedule` (`dispatch.go:390-414`, `index.js:354-359`).

- `schedule(input: ScheduleInput): Promise<string>` — returns the
  scheduled event's S3 key (for later cancel). `schedule.ts:166-193`.
- `ScheduleInput = { formationId: string; runAfterMs: number; actionRef: string; payload?: Record<string, unknown> }`
  (`schedule.ts:54-80`). Wrapper repacks into positional
  `(formationId, runAfterMs, actionRef, payload ?? null)`.
- Raw goja positional order is `(formationId, runAfterMs, actionRef,
  payload?)` (`bindings.go:1321-1349`). **Parity note:** the host
  channel op carries the args by NAME as
  `{formationId, actionRef, runAfterMs, payload?}` and both the goja
  installer and pod client map to it (`dispatch.go:390-414`,
  `index.js:354-359`).
- Requires bolt-level `schedule` (`capabilities.raindb.schedule: true`,
  `engine.go:607`). **Capability-denial parity gap:** the substrate
  denial message for schedule does NOT match `CAPABILITY_DENIAL_REGEX`
  (the formation-shape regex), so a denial surfaces as a plain
  `RainDBBoltError` carrying `binding: "ctx.schedule"` rather than a
  typed `CapabilityDenied` (`schedule.ts:18-27`, `constants.ts:164-173`).
- Throws `BindingNotInstalled` when `typeof ctx.schedule !== 'function'`
  (`schedule.ts::missingSchedule` `:101-113`).

---

### 2.14 `ctx.response` — streaming (SSE) surface

LIVE, but **present ONLY on `streaming: true` routes**. Wrapper
`src/bindings/response.ts`; raw goja `bindings.go::installResponseBinding`
(`:1383-1460`), wired only when the dispatcher passes a StreamingWriter
(`sandbox.go:164-165`). On non-streaming handlers `ctx.response` is
`undefined` and each wrapper method throws
`RainDBBoltError("... streaming is not enabled on this route ...")`
(`response.ts:59-67, 86-93, 125-133`).

- `setHeader(name: string, value: string): Promise<void>` — **MUST be
  called BEFORE the first write**; setting after the stream began panics
  goja-side (`response.ts:59-76`, raw `bindings.go:1389-1403`).
- `beginStream(status?: number): Promise<void>` — optional; the first
  `write()` infers status 200 (`response.ts:86-103`, raw `bindings.go:1405-1422`).
- `write(chunk: string | Uint8Array): Promise<number>` — returns the
  byte count written (Node `response.write()` parity); implicitly
  `beginStream(200)` on first call (`response.ts:125-143`, raw `bindings.go:1424-1457`).

A streaming handler must NOT also return a non-empty body; the engine
rejects that with a typed error (`sandbox.go:308-327`, `bolt-context.ts:200-208`).

> NOTE: the pod Node client (`index.js`) does not build a `ctx.response`
> namespace — streaming is a goja-engine surface in the current source.
> This is a parity observation, not a documented gap.

---

### 2.15 `ctx.tags` — ergonomic tag wrappers (LIVE tag/untag; STUB replaceTags)

Wrapper `src/bindings/tags.ts`. **There is NO substrate `ctx.tags`
namespace** — `tag`/`untag` route through the LIVE `db.tag`/`db.untag`
(which hit `ctx.db.tag`/`ctx.db.untag`) — `tags.ts:1-37`.

- `tag(formationId: string, scopeValue: string, tags: Record<string, string>): Promise<void>`
  — routes to `db.tag`. `tags.ts:103-110`.
- `untag(formationId: string, scopeValue: string, tagKeys: string[]): Promise<void>`
  — routes to `db.untag`. `tags.ts:122-129`.
- `replaceTags(formationId, scopeValue, tags): Promise<void>` — **STUB**;
  no native atomic replace exists; emulate via `untag` then `tag`
  (`tags.ts:148-166`).

---

### 2.16 `ctx.token` — STUB (idempotency-protected pointer claim)

Wrapper `src/bindings/token.ts`. All five methods throw
`BindingNotInstalled` until the substrate ships them. Shapes follow the
Go `Client.WriteToken/ClaimToken/ReadToken/DeleteToken/DeleteAllTokens`.

- `write(formationId, scopeValue, options: WriteTokenOptions): Promise<Token>` (`token.ts:70-88`).
- `claim(formationId, scopeValue, options: Omit<WriteTokenOptions, 'createOnly'>): Promise<Token>`
  — `createOnly` semantic; throws `TokenExists` on conflict (`token.ts:109-127`).
- `read(formationId, scopeValue): Promise<Token | null>` — may throw `TokenExpired` (`token.ts:135-151`).
- `delete(formationId, scopeValue): Promise<void>` (`token.ts:158-171`).
- `deleteAll(formationId): Promise<number>` — returns delete count (`token.ts:179-191`).
- `Token = { tokenId; formationId; scopeValue; author; ts; payload?; expiresAt? }`
  (`types/token.ts:16-25`); `WriteTokenOptions = { author; payload?; ttlSec?; createOnly? }`
  (`types/token.ts:31-45`).

---

### 2.17 `ctx.stats` — STUB (high-burst counters)

Wrapper `src/bindings/stats.ts`. Four methods, all `BindingNotInstalled`
until substrate v0.4. Backed by `Client.Mutate`'s atomic delta ops.

- `increment(formationId, scopeValue, field, delta = 1): Promise<void>` (`stats.ts:67-87`).
- `set(formationId, scopeValue, field, value): Promise<void>` (`stats.ts:95-114`).
- `batch(formationId, scopeValue, entries: StatsBatchEntry[]): Promise<void>`
  — `StatsBatchEntry = { field; op: 'increment' | 'set'; value }` (`stats.ts:26-30, 122-140`).
- `drain(formationId, scopeValue): Promise<void>` (`stats.ts:148-161`).
- May throw `StatsValidation` (unknown field / op-mismatch / no autoCache).

---

### 2.18 `ctx.relay` — STUB (contract-uncertain)

Wrapper `src/bindings/relay.ts`. Seven methods, all `BindingNotInstalled`.
Optional/required field distinctions may shift (`relay.ts:1-11`).

- `write(input: WriteRelayInput): Promise<RelayAddress>` (`relay.ts:95-107`).
- `read(input: ReadRelayInput): Promise<RelayResult | null>` (`relay.ts:113-123`).
- `updateStatus(input: UpdateRelayStatusInput): Promise<void>` (`relay.ts:129-139`).
- `spawnChild(input: SpawnChildInput): Promise<RelayAddress>` (`relay.ts:145-155`).
- `writeLog(input: WriteRelayLogInput): Promise<void>` (`relay.ts:161-171`).
- `enqueueToken(input: EnqueueTokenInput): Promise<RelayAddress>` (`relay.ts:177-187`).
- `dequeueToken(input: DequeueTokenInput): Promise<void>` (`relay.ts:193-203`).
- Types in `src/types/relay.ts`: `RelayAddress`, `RelayLogEntry`,
  `RelayResult`, `ReadRelayOptions`, `RelayDetails`.

---

### 2.19 `ctx.actions` — STUB

Wrapper `src/bindings/actions.ts`.

- `dispatch(formationId, actionName, input: Record<string, unknown>): Promise<DispatchActionResult>`
  — fire-and-forget; `DispatchActionResult = { actionId }` (`actions.ts:14-16, 50-66`).
- `invoke(formationId, actionName, input, opts?: { timeoutMs? }): Promise<InvokeActionResult>`
  — synchronous on cyclone; `InvokeActionResult = { result: unknown; durationMs }`
  (`actions.ts:25-28, 75-94`).

---

### 2.20 `ctx.vectors` — STUB (contract-uncertain)

Wrapper `src/bindings/vectors.ts`. Vector param shape may tighten from
`number[]` to `Float32Array` (`vectors.ts:1-11`).

- `query(input: VectorQueryInput): Promise<VectorHit[]>` —
  `VectorQueryInput = { formationId; vector: number[]; opts?: VectorQueryOpts }` (`vectors.ts:17-22, 67-77`).
- `queryByText(input: VectorQueryByTextInput): Promise<VectorHit[]>` —
  `{ formationId; text; opts? }` (`vectors.ts:31-35, 85-100`).
- `deleteFormation(formationId: string): Promise<void>` (`vectors.ts:107-118`).
- `VectorQueryOpts = { limit?; minSimilarity?; tags?: string[] }` (`vectors.ts:24-29`);
  `VectorHit = { scopeValue; similarity; fieldName?; metadata? }` (`vectors.ts:37-42`).

---

### 2.21 `ctx.files` — STUB

Wrapper `src/bindings/files.ts`.

- `reserveUpload(input: ReserveUploadInput): Promise<ReserveUploadResult>`
  — result `{ uploadUrl; headers; expiresAt; objectKey }` (`files.ts:8-24, 90-102`).
- `reserveDownload(input: ReserveDownloadInput): Promise<ReserveDownloadResult>`
  — result `{ downloadUrl; expiresAt }` (`files.ts:26-36, 108-123`).
- `pushPublic(input: PushPublicInput): Promise<PushPublicResult>` —
  result `{ publicUrl; publicPath; contentType; size }` (`files.ts:38-51, 129-144`).
- `readMeta(input: ReadMetaInput): Promise<ReadMetaResult>` —
  result `{ size; contentType; etag; sha256 }` (`files.ts:53-64, 150-160`).

---

### 2.22 `ctx.catalog` — STUB (contract-uncertain)

Wrapper `src/bindings/catalog.ts`. `insert/list/tree` are the likely v1
scope; `delete/update/transfer` are stubbed for completeness (`catalog.ts:1-9`).

- `insert(input: CatalogInsertInput): Promise<CatalogInsertResult>` — `{ entryId }` (`catalog.ts:16-25, 99-111`).
- `list(input: CatalogListInput): Promise<CatalogListResult>` (`catalog.ts:47-62, 117-127`).
- `tree(input: CatalogTreeInput): Promise<CatalogTreeNode>` (`catalog.ts:64-74, 133-143`).
- `delete(input: CatalogDeleteInput): Promise<void>` (`catalog.ts:156-166`).
- `update(input: CatalogUpdateInput): Promise<void>` (`catalog.ts:174-184`).
- `transfer(input: CatalogTransferInput): Promise<void>` (`catalog.ts:192-202`).

---

### 2.23 `ctx.formations` — STUB

Wrapper `src/bindings/formations.ts`.

- `describe(formationId: string): Promise<FormationDescription>` (`formations.ts:42-53`).
- `list(): Promise<FormationSummary[]>` (`formations.ts:59-69`).
- `warm(formationIds: string[]): Promise<void>` (`formations.ts:75-85`).

---

### 2.24 `ctx.flows` — STUB

Wrapper `src/bindings/flows.ts`.

- `queryState(input: QueryFlowStateInput): Promise<FlowState>` —
  `QueryFlowStateInput = { formationId; flowId; scopeValue }`;
  `FlowState = Record<string, unknown>` (`flows.ts:8-14, 32-42`).

---

### 2.25 `ctx.bolt` — static bolt metadata

`BoltMeta` (`src/types/bolt-context.ts:56-67`), built by the goja sandbox
(`sandbox.go:167-172`) and the pod (`index.js:184-186`).

- `id: string`, `name: string`, `revision: string`, `tenantId: string`
  (all present today).
- `standardBucket?`, `publicBucket?`, `region?` — STUB, optional until
  the substrate ships them (`bolt-context.ts:61-66`).

> `ctx.bolt.tenantId` is the bolt's HOST tenant — distinct from
> `ctx.auth.tenantId` (the requesting user's tenant).

---

### 2.26 `ctx.trigger` — non-HTTP invocation payload

Present ONLY for scheduled/event/callback invocations; a plain HTTP
request has no `ctx.trigger` (goja adds it only when `input.Trigger.Kind
!= "" || len(payload) > 0` — `sandbox.go:181-190`). Type
`BoltTriggerRequest.trigger = { kind: string; payload: Record<string, unknown> }`
(`bolt-context.ts:193-198`). Branch on presence to distinguish HTTP from
trigger invocations.

---

## 3. The `req` object

`BoltRequest` (`src/types/bolt-context.ts:171-186`), built by the goja
sandbox (`sandbox.go:192-244`). The pod supervisor matches this shape.

| Field | Type | Notes |
| --- | --- | --- |
| `method` | `string` | `sandbox.go:193` |
| `path` | `string` | `sandbox.go:194` |
| `params` | `Readonly<Record<string, string>>` | route params; empty object when none (`sandbox.go:195-203`) |
| `headers` | `Readonly<Record<string, string \| string[]>>` | **keys LOWERCASED**; single values scalarized to a string, multi-values kept as arrays (`sandbox.go:204-222`) |
| `query` | `Readonly<Record<string, string \| string[]>>` | single values scalarized, multi kept as arrays (`sandbox.go:223-235`) |
| `body?` | `string` | raw text; empty string for GET/HEAD (`sandbox.go:236-239`) |
| `json?` | `unknown` | present ONLY when the body parses as JSON (`sandbox.go:240-243`) |

Header lowercasing lets handlers read `req.headers['cookie']` regardless
of wire casing — matching Fetch/Express/Fastify/Hono convention
(`sandbox.go:206-209`).

---

## 4. Engine parity model

A bolt is authored ONCE against `@raindb/bolt-sdk` and runs unchanged on
either engine. The `ctx` surface is provided by **four pieces that must
stay in parity**:

1. **goja bindings (in-process)** —
   `pkg/lightning/engines/goja/bindings.go`, the 14 `install*Binding`
   functions (`installLogBinding`, `installDBBinding`,
   `installObjectsBinding`, `installSQLBinding`, `installFetchBinding`,
   `installSecretsBinding`, `installIDsBinding`, `installJWTBinding`,
   `installCryptoBinding`, `installCookiesBinding`, `installIAMBinding`,
   `installAuthBinding`, `installScheduleBinding`,
   `installResponseBinding`) — plus `sandbox.go` which builds
   `ctx.bolt`/`ctx.trigger` and the `req` object.
2. **pod-channel host dispatch** —
   `internal/lightning/podchannel/dispatch.go` (the `handle*` functions +
   `dispatchTable`) and `protocol.go` (the `Op*` wire-op string
   constants + `Request`/`Response` framing).
3. **pod Node client** —
   `raindb-lightning-pods/sdk-clients/nodejs/index.js` — `makeCtx()` and
   `makeAuth()`, which turn `ctx.<ns>.<method>(...)` into
   `channel.call('<op>', {...})`.
4. **the TS wrapper a bolt author imports** —
   `raindb-bolt-sdk-ts/src/bindings/*.ts` + `src/types/*.ts`. This is the
   author-facing contract; the other three implement the `ctx` it
   resolves through.

### Adding a binding requires all of #1, #2, #3

For a method to run on both engines, it must be installed in the goja
binding (#1), have a host dispatch handler + `Op*` constant (#2), AND be
built in the node client's `makeCtx` (#3). The TS wrapper (#4) rides on
top and works the moment the raw `ctx` method exists; where the raw
method is absent the wrapper throws `BindingNotInstalled`.

### Return shapes must match the goja binding

The goja binding is the reference shape. The host frequently **wraps**
its result under a sub-key (`okResp(map{"row": ...})`,
`{"page": ...}`, `{"values": ...}`, `{"days": ...}`) —
`dispatch.go` + `server.go::okResp/errResp` (`server.go:246-252`). The
**node client unwraps** it so the pod's raw `ctx` surface is identical to
goja's direct-return shape. Concrete cases:

- `db.readLatest`/`readDroplet`: host `{row}` → node `.row ?? null`
  (matches goja's direct droplet/null).
- `db.listDroplets`/`listKeys`: host `{page}` (PascalCase Go JSON) →
  node maps to lowercase `{droplets|keys, nextCursor, hasMore, ...}`.
- `db.mutateAndRead`: host `{values}` → node `.values` (goja returns the
  values map directly).
- `db.expirationDays`: host `{days}` → node `.days`.
- `sql.query`/`objects.exists`/`fetch.do`: host returns a flat map that
  the node client returns directly or reshapes to the goja projection.

### `permits()` is SYNCHRONOUS

`ctx.auth.permits(...)` and `ctx.auth.permitsWireKeySubscribe(...)`
return **booleans, not Promises** — the TS wrapper contract
(`auth.ts:92,106`) calls them synchronously. On goja this is trivially
in-process (`bindings.go:1272-1289`). On the pod, the host
**pre-evaluates the declared-resource permit decisions into the invoke
frame** so `makeAuth` can answer locally and synchronously; a check for
an UNDECLARED resource returns `false` — the same conservative default
the wrapper documents for an absent `ctx.auth`
(`index.js:481-511`). This avoids shipping grant/policy material or a
key into the pod.

### Capability enforcement is host-side on both engines

Neither the pod channel nor the node client re-implements enforcement.
Every capability/grant/egress check lives in the engine-agnostic SDK
implementation; the pod channel is a thin transport
(`protocol.go:7-18`). A pod bolt missing a declared op gets the SAME
`CapabilityDenied` a goja bolt gets — "contract parity, not engine
parity" (`dispatch.go:662-667`).

---

## 5. Errors

Error translation is centralized in
`src/errors/from-binding.ts::translateBindingError` — every binding
wrapper routes its catch path through it. Class hierarchy in
`src/errors/classes.ts`; all descend from `RainDBBoltError` so a bolt can
catch the whole family with one `instanceof`.

### Translation order (`from-binding.ts:44-123`)

1. Already a `RainDBBoltError` → rethrown unchanged (no double-wrap).
2. `Error.name` matches a known typed name → the matching typed subclass.
3. `Error.message` matches `CAPABILITY_DENIAL_REGEX` → `CapabilityDenied`.
4. Fall through → generic `RainDBBoltError` **preserving the original
   message**.

### `Error.name` → typed subclass (`constants.ts:183-189`, `from-binding.ts:69-97`)

| `Error.name` | Class | Class source |
| --- | --- | --- |
| `TokenExists` | `TokenExists` (carries `formationId?`/`scopeValue?` when the substrate stamps them) | `classes.ts:112-130` |
| `TokenExpired` | `TokenExpired` | `classes.ts:137-142` |
| `ConditionFailed` | `ConditionFailed` (CAS / create-only unsatisfied) | `classes.ts:149-154` |
| `StatsValidation` | `StatsValidation` | `classes.ts:162-167` |
| `AuthorRequired` | `AuthorRequired` | `classes.ts:174-178` |

### Capability denials → `CapabilityDenied`

The substrate emits capability errors as
`ctx.<binding>: <op> on formation "<formationId>" not declared in capabilities`.
`CAPABILITY_DENIAL_REGEX` (`constants.ts:202-203`) parses the `<op>`
(hyphens allowed, e.g. `object-read`, `relay-write`) and `<formationId>`;
the wrapper throws `CapabilityDenied` with `.formationId` and `.op`
populated (`classes.ts:64-78`, `from-binding.ts:106-113`).

> **Known regex gap:** `ctx.schedule` denials do NOT match the
> formation-shape regex (schedule is bolt-level, not per-formation), so a
> schedule capability denial surfaces as a plain `RainDBBoltError`
> carrying `binding: "ctx.schedule"` and the original message
> (`schedule.ts:18-27`, `constants.ts:164-173`).

### `BindingNotInstalled`

`classes.ts:89-94`. Produced by the **package's own** stub / guard path
(`src/runtime/binding-not-installed.ts::stubOrDispatch`, and the inline
`typeof ctx.<ns>.<method> !== 'function'` / `ctx.<ns> === undefined`
guards) — NOT by the substrate. Two triggers: an unbound method on a
current runtime (missing capability declaration), or a lightning binary
too old to ship the binding. `BindingNotInstalled` is deliberately absent
from the `Error.name` switch (`from-binding.ts:61-63`).

### Generic fallback

Any unrecognized error becomes a `RainDBBoltError` that **preserves the
original message** and carries the `binding` name for log correlation
(`from-binding.ts:116-122`; base class `classes.ts:28-38`).

---

## 6. Capabilities

A bolt declares its capabilities in its manifest
(`capabilities.raindb.*` / `capabilities.network.*`); the host enforces
the gate before any binding call reaches the SDK. Canonical op strings
(`pkg/lightning/runtime/engine.go:542-608`):

**Per-formation ops** — `capabilities.raindb.formations[].ops`; validator
rejects any op not in `AllowedFormationOps` (`engine.go:613-615`):

| Op string | Const | Gates |
| --- | --- | --- |
| `read` | `OpRead` | `readLatest`, `readDroplet`, `readAt`, `readCurrent`, token read |
| `write` | `OpWrite` | `writeDroplet`, `writeBatch` |
| `list` | `OpList` | `listDroplets`, `listKeys`, `listSince` |
| `token-write` | `OpTokenWrite` | `writeToken`, token claim/delete |
| `stats` | `OpStats` | stats increment/set/batch |
| `tag` | `OpTag` | `tag`, `untag` (distinct from `write`) |
| `expire` | `OpExpire` | `expire` (destructive; distinct from `write`) |
| `mutate` | `OpMutate` | `mutate`, `mutateAndRead` (formation must declare `lifecycle.autoCache: true`) |

**Per-bucket ops** — `capabilities.raindb.objects.ops`;
`AllowedBucketOps` (`engine.go:620-622`):

| Op string | Const | Gates |
| --- | --- | --- |
| `object-read` | `OpObjectRead` | `objects.get`, `objects.exists` |
| `object-write` | `OpObjectWrite` | `objects.put`, `objects.delete` |

**Bolt-level boolean ops** — `AllowedBoltLevelOps` (`engine.go:629-632`):

| Op string | Const | Manifest flag | Gates |
| --- | --- | --- | --- |
| `sql-read` | `OpSQLRead` | `capabilities.raindb.sqlRead: true` | `sql.query` |
| `schedule` | `OpSchedule` | `capabilities.raindb.schedule: true` | `ctx.schedule` |

**Other manifest-declared gates:**

- `capabilities.raindb.secrets.names[]` — the set of secret names
  `ctx.secrets.get` / `ctx.jwt` may resolve (`secrets.ts:24`, `jwt.ts:41`).
- `capabilities.network.egress[]` — the host allowlist for `ctx.fetch`;
  non-allowlisted hosts reject (`fetch.ts:13-18`).

The publish-time manifest validator rejects any op string not in the
appropriate `Allowed*` slice (`engine.go:540-541`). Enforcement is
host-side and identical across engines (§4).

---

## Appendix: parity gaps and ambiguities found

The following are the substantive parity gaps / ambiguities observed
while cross-checking the four pieces against each other:

1. **`ctx.response` (streaming) is goja-only in the current source.**
   `installResponseBinding` exists in `bindings.go` and the wrapper in
   `response.ts`, but `raindb-lightning-pods/sdk-clients/nodejs/index.js`
   `makeCtx` builds no `response` namespace and no `OpResponse*` wire ops
   exist in `protocol.go`/`dispatch.go`. A `streaming: true` route
   therefore has no pod-engine implementation in this source snapshot.

2. **`ctx.schedule` capability-denial is not typed.** The denial message
   is bolt-level and does not match `CAPABILITY_DENIAL_REGEX`, so it
   surfaces as a generic `RainDBBoltError`, not `CapabilityDenied`
   (documented in-source at `schedule.ts:18-27`).

3. **Result-wrapping asymmetry that MUST be maintained by hand.** The
   host `okResp` wraps under `{row}`/`{page}`/`{values}`/`{days}` and the
   node client unwraps to match goja's direct-return shape. `listDroplets`
   and `listKeys` additionally require PascalCase→lowercase key mapping
   in the node client (`index.js:209-249`) because the host emits Go
   struct JSON. Any new list/page-returning binding must replicate this
   mapping in all three implementing pieces or the two engines diverge.

4. **Many namespaces are STUB in the TS wrapper** (`token`, `stats`,
   `relay`, `actions`, `vectors`, `files`, `catalog`, `formations`,
   `flows`, plus `db.readAt`/`readCurrent`/`resolveFormation` and
   `tags.replaceTags`). None have goja installers, `Op*` constants, or
   node-client methods in this source, so they throw
   `BindingNotInstalled` on every engine. `relay`, `vectors`, and
   `catalog` are additionally flagged CONTRACT-UNCERTAIN in their
   wrappers (shapes may change before they ship).

5. **`ctx.stats` op-string presence gap.** `OpStats = "stats"` is in
   `AllowedFormationOps` (`engine.go:614`) but the stats binding itself
   is unshipped on every engine — the capability op exists ahead of the
   binding.

6. **`sql.query` positional-index example is stale in one JSDoc.** The
   `sql.query` return contract is correctly documented as column-keyed
   objects (`rows[i][columnName]`), but one `@example` in `sql.ts:200-204`
   still reads `r.rows[0]?.[nIdx]` using a numeric index — a doc
   inconsistency, not a runtime one (the runtime shape is named objects).

7. **`objects.get` returns a string on both engines**, but the
   underlying byte→string conversion differs (goja `string(data)` UTF-8;
   pod base64-decode then `.toString()`); binary blobs that are not valid
   UTF-8 may round-trip differently. Uint8Array return is explicitly
   deferred (`objects.ts:20-21`).
