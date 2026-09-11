# RainDB Bolt SDK reference

`@raindb/bolt-sdk` is the public TypeScript SDK for applications running on the
RainDB Platform. Its exported types and JSDoc describe inputs, results, required
capabilities, and examples. [README.md](README.md) provides the complete usage
walkthrough; [CONTRIBUTING.md](CONTRIBUTING.md) describes standalone local tests.

## Context and execution

Call `setCtx(ctx)` at the start of the handler before using imported wrappers.
Named-input wrappers adapt to the runtime context. Goja and Node bolt engines
serve the same supported application contract; engine selection does not grant
additional tenant permissions. `ctx.auth` identifies the current authenticated
actor, while `ctx.bolt` describes the deployed bolt.

Use `await` for asynchronous operations. Check the exported signature for
synchronous operations such as `ctx.auth.permits`. Streaming responses require
a route configured for streaming and the documented response lifecycle.

## Data and pagination

A droplet identifies an immutable revision. A scope value identifies the logical
entity; these identifiers are not interchangeable. Use formation indexes and
SDK operations to address entities rather than deriving storage paths.

- `db.readLatest` and `db.readDroplet` return the documented droplet shape.
- `db.writeDroplet` and `db.writeToken` expose their supported result fields;
  do not infer one operation's result from another operation's name.
- `db.listDroplets` accepts semantic scope narrowing through `scopeValue`.
  Do not combine `scopeValue` with a raw prefix when the operation rejects that
  combination.
- `db.listKeys` returns `lastModified` as a string. Droplet `ts` is a millisecond
  number. The agent adapter separately projects GraphQL timestamp values.
- `db.listSince` continuation cursors must be passed unchanged. An empty page
  can have `hasMore: true`; continue with its advancing cursor. A final page can
  carry a cursor for the next poll even when `hasMore` is false.

Consult the types in [src/bindings/db.ts](src/bindings/db.ts) and
[src/types](src/types) for exact optional properties and operation-specific
options. Local tests demonstrate empty, missing, and malformed result cases.

## SQL

`sql.query` supports optional `planStrategy: 'range' | 'scan'`. Omission uses
the formation/platform default. Preserve explicit caller values; invalid values
must not silently become omission. Planner selection does not by itself expose
historical snapshot selection.

`withFreshness: true` requests freshness bookmarks. Use `freshnessStatus` and
the exported helpers to interpret them. `queryEntityRowsFresh` merges an entity
row set with a bounded tail and fails when it cannot establish coverage. It
**does not reapply WHERE, ORDER BY, or LIMIT** after the merge and must not be
used to freshen aggregates. Use plain `query` when eventual analytical results
are appropriate. Read [src/bindings/sql.ts](src/bindings/sql.ts) before depending
on the helper's constrained result semantics.

## Files and availability

`files.reserveUpload` uses the authorized upload reservation operation.
`files.reserveDownload` returns fully buffered bytes and a data URL; it is not
an expiring download artifact or a complete streaming export API.

Some wrappers compose supported operations; others require a runtime binding.
A declared method alone does not establish availability. The README's binding
tables distinguish available methods from explicit stubs. Do not treat matching
errors on two engines as evidence of successful operation.

## Errors and authorization

Use the exported error classes, including `CapabilityDenied` and
`BindingNotInstalled`. Error metadata identifies the binding and applicable
input. Do not classify failures by private implementation wording or parse
messages in place of typed errors. A missing binding and a rejected permission
are distinct failures.

Declare the capabilities the application needs. Neither a wrapper nor the
agent bridge bypasses tenant authorization. Keep credentials and private data
out of logs and user-visible error details.

## Tests and examples

`npm ci`, `npm run lint`, `npm test`, and `npm run build` run with declared
SDK dependencies. Unit tests inject a local mock context and require no service
source, operator profile, or deployed bolt. The example application is separately
typechecked; running it requires the user's own tenant resources and permissions.
