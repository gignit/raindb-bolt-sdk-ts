# @raindb/bolt-sdk

Typed bindings for Lightning Bolt handler authors. Zero runtime overhead.

## What this is

A TypeScript NPM package giving you a typed, ergonomic API over the goja sandbox bindings that RainDB Lightning Bolts use at runtime. Write bolt handlers with full IntelliSense, type safety, and typed error discrimination.

The package's runtime cost is ~zero: at runtime, the compiled JS calls `ctx.*` directly. The package's value is at **dev time** -- types, completion, refactoring, typed error classes.

## Quick start

```typescript
// bolt/server/src/index.ts
import {
  setCtx,
  db,
  log,
  BoltContext,
  BoltRequest,
  BoltResponse,
  CapabilityDenied,
} from '@raindb/bolt-sdk';

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);

  const id = req.params['id'];
  if (!id) return { status: 400, body: 'missing id' };

  try {
    const agent = await db.readLatest({
      formationId: 'agent-graph',
      indexId: 'by-id-latest',
      scopeValue: id,
    });
    if (agent === null) {
      return { status: 404, body: { error: 'not found' } };
    }
    log.info('agent read', { id });
    return { status: 200, body: agent };
  } catch (e) {
    if (e instanceof CapabilityDenied) {
      return {
        status: 403,
        body: `bolt missing ${e.op} on ${e.formationId}`,
      };
    }
    throw e;
  }
}
```

The `setCtx(ctx)` call is the **required first line of every handler**. It registers the invocation's `ctx` so subsequent calls into `db.*`, `log.*`, etc. resolve through it. Skipping it means the SDK throws `RainDBBoltError("setCtx not called")` on the first wrapper call.

## What you get

- **IntelliSense everywhere.** Every binding namespace is fully typed. Hover any method to see its signature.
- **Typed error classes.** `catch (e) { if (e instanceof TokenExists) { ... } }`. Discriminate on actual error types, not magic strings.
- **Zero runtime overhead.** The package compiles to thin promise wrappers around the goja bindings. At runtime your bolt is the same speed as if you wrote raw `ctx.*` calls.
- **Stable API surface.** Mirrors the goja binding contract; changes follow the same versioning as the substrate.
- **Cross-validated against `@raindb/agent`.** Input/output types are structurally compatible with `@raindb/agent`'s tool catalogs so the two packages compose without translation.

## API surface (v0.1.0)

| Namespace      | Status   | Methods                                                                                |
|----------------|----------|----------------------------------------------------------------------------------------|
| `log`          | LIVE     | `info`, `warn`, `error`                                                                |
| `db`           | LIVE     | `readLatest`, `readDroplet`, `writeDroplet`, `listDroplets`                            |
| `db` (cont'd)  | STUB     | `listKeys`, `listSince`, `writeBatch`, `readAt`, `readCurrent`, `resolveFormation`, `expire`, `expirationDays` |
| `fetch`        | LIVE     | (callable)                                                                             |
| `secrets`      | LIVE     | `get`                                                                                  |
| `ids`          | LIVE     | `uuidv7`                                                                               |
| `jwt`          | LIVE     | `sign`, `verify`                                                                       |
| `crypto`       | LIVE     | `hashPassword`, `verifyPassword`, `randomBytes`                                        |
| `cookies`      | LIVE     | `parse`, `build`                                                                       |
| `iam`          | LIVE     | `mintWireToken`                                                                        |
| `response`     | LIVE     | `setHeader`, `beginStream`, `write` (streaming routes only)                            |
| `token`        | STUB     | `write`, `claim`, `read`, `delete`, `deleteAll`                                        |
| `stats`        | STUB     | `increment`, `set`, `batch`, `drain`                                                   |
| `objects`      | STUB     | `get`, `put`, `exists`, `delete`                                                       |
| `sql`          | STUB     | `query`                                                                                |
| `relay`        | STUB     | `write`, `read`, `updateStatus`, `spawnChild`, `writeLog`, `enqueueToken`, `dequeueToken` |
| `actions`      | STUB     | `dispatch`, `invoke`                                                                   |
| `tags`         | STUB     | `tag`, `untag`, `replaceTags`                                                          |
| `vectors`      | STUB     | `query`, `queryByText`, `deleteFormation`                                              |
| `files`        | STUB     | `reserveUpload`, `reserveDownload`, `pushPublic`, `readMeta`                           |
| `catalog`      | STUB     | `insert`, `list`, `tree`, `delete` (TBD), `update` (TBD), `transfer` (TBD)             |
| `formations`   | STUB     | `describe`, `list`, `warm`                                                             |
| `flows`        | STUB     | `queryState`                                                                           |

LIVE = the substrate ships this binding today; the wrapper dispatches through.
STUB = the wrapper ships now with the eventual shape; calling it at runtime throws `BindingNotInstalled` until the substrate-side native binding lands. See `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md` for the substrate-side roadmap and `BOLT_SDK_COORDINATION.md` for the live ship-status ledger.

## Error handling

Every binding wrapper translates substrate-side errors to typed classes. Catch with `instanceof`:

```typescript
import {
  RainDBBoltError,         // base; catch-all for anything from the SDK
  CapabilityDenied,        // bolt's capabilities.json missing an op
  BindingNotInstalled,     // STUB binding called against a substrate that hasn't shipped it
  TokenExists,             // claim against an existing scope
  TokenExpired,            // token recycled by lifecycle
  ConditionFailed,         // CAS write rejected (expectedETag, ifFieldEquals)
  StatsValidation,         // stats binding rejected (unknown field, op-mismatch, ...)
  AuthorRequired,          // wrapper couldn't derive a required author field
} from '@raindb/bolt-sdk';

try {
  await token.claim('continuum-stats', 'global', { author: 'bot' });
} catch (e) {
  if (e instanceof TokenExists) {
    // already initialized; safe to ignore in init paths
  } else if (e instanceof BindingNotInstalled) {
    // substrate-side hasn't shipped ctx.token yet
    log.warn('token binding pending', { e: String(e) });
  } else if (e instanceof RainDBBoltError) {
    log.error('sdk error', { binding: e.binding, msg: e.message });
    throw e;
  } else {
    throw e;
  }
}
```

`RainDBBoltError.binding` carries the canonical binding name (e.g. `"ctx.db.readLatest"`) for log correlation.

## Running LLM agents inside a bolt

`@raindb/bolt-sdk` ships a sub-module `@raindb/bolt-sdk/agent-bridge` that builds an `AgentHost` for `@raindb/agent`'s `runAgent`. Substrate-touching tool calls (droplet_*, etc.) are intercepted at the host's `fetch` boundary and dispatched through native bindings -- no HTTP self-loops.

```typescript
import { setCtx } from '@raindb/bolt-sdk';
import { makeBoltNativeHost } from '@raindb/bolt-sdk/agent-bridge';
import { runAgent, tenantTools } from '@raindb/agent';

export async function onHttpRequest(ctx, req) {
  setCtx(ctx);
  const result = await runAgent({
    host: makeBoltNativeHost(ctx),
    tools: tenantTools,
    messages: req.json.messages,
  });
  return { status: 200, body: result };
}
```

The bolt code reads like normal agent code; the perf win (no kernel network stack overhead per call) is invisible at the call site.

`@raindb/agent` is declared as an OPTIONAL peer dependency. Bolts that don't run LLM agents don't need it installed.

## Stubbed bindings

Some surfaces are stubbed -- the wrapper ships with full types, but the substrate-side native binding has not yet landed. Calling a stubbed binding throws `BindingNotInstalled` at runtime with a message pointing at the audit gap card:

```
ctx.sql.query is not installed in this bolt runtime. The @raindb/bolt-sdk
wrapper is shipped; the substrate-side binding is pending. See
~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md for the gap
card that owns this surface, and ~/src/raindb-phoenix-lightning/docs/
BOLT_SDK_COORDINATION.md for current substrate ship status.
```

When the substrate-side ships a binding, the package version bumps from `0.x` to `0.x+1` (semver minor), the wrapper swaps from "type-only stub" to "documented as live" in CHANGELOG.md, and consumers get the new capability by upgrading.

Bolt code that uses a stubbed surface compiles successfully today; deployment requires the native binding to be present.

## Migration from raw `ctx.*` calls

If you have an existing bolt written in plain JavaScript using `ctx.db.readLatest(...)`, migrating to `@raindb/bolt-sdk` is:

1. Add the dependency.
2. Add `setCtx(ctx)` as the first line of each handler.
3. Replace `ctx.db.readLatest(formationId, indexId, scopeValue)` with `db.readLatest({ formationId, indexId, scopeValue })` (named-args object).
4. Wrap binding calls in `try/catch` and discriminate with `instanceof`.

The compiled output is functionally equivalent. The gain is dev-time type safety + clean error discrimination.

## Compatibility

| `@raindb/bolt-sdk` | raindb-lightning bolt runtime          | `@raindb/agent`     |
|--------------------|----------------------------------------|---------------------|
| 0.1.x              | 1.0.x (the LIVE bindings live today)   | 0.7.x (optional)    |
| 0.2.x (planned)    | 1.1.x (post-v0.4 token+stats)          | 0.8.x               |
| 1.0.x (target)     | 1.5.x (all gap cards landed)           | 1.0.x               |

The compatibility table is the source of truth; pin both `@raindb/bolt-sdk` and the bolt's `raindb-lightning` runtime accordingly.

## Building

```sh
npm install
npm run lint        # tsc --noEmit on src + test
npm run test        # Tier 1 unit + Tier 3 shape-compat
npm run build       # produces dist/
npm pack            # produces a tarball with dist/, README.md, CHANGELOG.md only
```

The `test/integration/example-bolt/` directory is the canonical "smallest complete bolt using @raindb/bolt-sdk" reference. It compiles cleanly under the same TypeScript strictness the package uses (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, full strict mode). To run its e2e suite against devz, set `RAINDB_DEVZ_PROFILE=<profile-name>` and run `npm run test:e2e` from the bolt's directory; without that env var the suite skips cleanly.

## License

Internal (private package). Public license TBD when the package goes public.

## See also

- `~/src/raindb-phoenix-lightning/docs/HANDOFF_RAINDB_BOLT_SDK_TS.md` -- the constitutional spec
- `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md` -- substrate-side roadmap
- `~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md` -- live binding ship-status ledger
- `~/src/raindb-agent-ts/` -- sister package; LLM tool catalog over GraphQL
