# Contributing to @raindb/bolt-sdk

This document is for the package's maintainer agents. The README is for bolt authors.

## The swap protocol: stub -> live

The package's primary maintenance loop is "the substrate-side agent shipped a binding; swap our stub to live."

### Pre-conditions

1. The substrate-side PR landed in `~/src/raindb-phoenix-lightning/`. Its PR description includes a line like `bolt-sdk-ready: ctx.<binding>`.
2. `BOLT_SDK_COORDINATION.md` (in the substrate repo's `docs/`) shows the binding's substrate column moved to `LANDED-<sha>`.

### The swap steps

For a single binding (e.g. `ctx.sql.query` -- audit §H Gap 3):

1. **Read the goja-side installer** in `~/src/raindb-phoenix-lightning/pkg/lightning/engines/goja/bindings.go`. Verify the wrapper's input shape matches what we declared in `src/bindings/sql.ts::SqlQueryInput`. If they diverge, decide:
   - Substrate's shape wins -> update our types + bump minor version (breaking type change is documented in CHANGELOG).
   - Our shape was correct -> file an issue in the substrate repo asking the substrate side to align.
2. **Read the @raindb/agent counterpart** in `~/src/raindb-agent-ts/src/tools/`. Confirm shape parity. Update the shape-compat test under `test/unit/shape-compat/` if necessary.
3. **Confirm the wrapper's call shape**. The stub uses `stubOrDispatch` which checks for the function's presence at runtime. If the substrate-side has shipped, no code change to the wrapper is required -- the dispatch automatically activates. The "swap" is therefore mostly:
   - Update the JSDoc on the wrapper from `STUB (audit §X)` to `LIVE (substrate <commit-sha>)`.
   - Remove the `BindingNotInstalled` callout.
   - Add `@example` blocks demonstrating the now-working call.
4. **Add tests**. Tier 1 unit test (mock ctx with the dispatch path) AND a shape-compat test in `test/unit/shape-compat/`. Tier 2 (e2e) for any binding that touches substrate state.
5. **Update CHANGELOG.md**. Under a new `## [0.x+1.0]` heading:
   - `### Changed`: list which binding swapped from STUB to LIVE.
   - Reference the substrate commit SHA.
6. **Update `BOLT_SDK_COORDINATION.md`** (in the substrate repo) to flip the bolt-sdk column to `LIVE-SINCE-v0.x+1.0`. (Coordinate with the architect; the file lives outside this repo.)
7. **Bump version**. Edit `package.json` and `src/index.ts::VERSION` together (they MUST match -- the test suite asserts equality at runtime).
8. **Open the swap PR**. Title format: `swap stub to live: ctx.<binding>`. Description references the substrate PR by SHA.

### Version bump rules

| Change                                 | Severity                                          |
|----------------------------------------|---------------------------------------------------|
| Stub -> live (no shape change)         | minor                                             |
| Stub -> live with input shape change   | minor (during 0.x); major (post 1.0)              |
| Add a new optional method              | minor                                             |
| Add a new required method              | major (post 1.0); minor during 0.x with notice    |
| Tighten an input type                  | major                                             |
| Loosen an input type                   | minor                                             |
| Add an optional output field           | minor                                             |
| Remove an output field                 | major                                             |
| Add a new error class                  | minor                                             |
| Remove an error class                  | major                                             |
| Rename a field                         | major                                             |

## Cross-cutting concerns

### The single-source-of-truth rule for binding names

`src/internal/constants.ts` exports `BINDING` -- a const map from `<binding>_<method>` keys to canonical strings (`"ctx.db.readLatest"` etc.). Every wrapper references these constants in `error.binding`, log tags, and stub-not-installed messages. Never hardcode a binding name string elsewhere. When a binding is added, its constant lands here first.

### The capability-denial regex

`CAPABILITY_DENIAL_REGEX` in `constants.ts` parses the substrate's capability-denial error message into `(op, formationId)`. The regex assumes a stable substrate-side message format:

```
ctx.<binding>: <op> on formation "<name>" not declared in capabilities
```

If the substrate reformats, the regex misses and `CapabilityDenied` falls through to plain `RainDBBoltError`. Coordinate with the substrate-side agent if the message format changes -- this is open question 7 in the handoff doc.

### exactOptionalPropertyTypes

The package's `tsconfig.json` enables `exactOptionalPropertyTypes`. This means `{ x?: T }` is NOT the same as `{ x?: T | undefined }` -- you cannot assign `undefined` to an absent-by-default field. Patterns:

```typescript
// WRONG (under exactOptionalPropertyTypes):
const opts = { foo: maybeFoo };  // if maybeFoo is `string | undefined`, error

// RIGHT: build the object conditionally
const opts: { foo?: string } = {};
if (maybeFoo !== undefined) opts.foo = maybeFoo;
```

Test files mocking ctx bindings can use the `Type | undefined` workaround when they need to capture `undefined` values; production code in `src/` should not.

## Test progression

Per handoff §L:

- **Tier 1 (unit, in `test/unit/*.test.ts`)**: mock ctx; assert wrapper translates inputs, outputs, and errors. Coverage: every wrapper has at least one happy path + one error-translation test.
- **Tier 2 (integration, `test/integration/example-bolt/`)**: real bolt deployed to devz. Gated behind `RAINDB_DEVZ_PROFILE`. v0.1 ships the harness as documented-but-stubbed; wire it up in v0.2.
- **Tier 3 (shape-compat, `test/unit/shape-compat/*.test.ts`)**: compile-time proofs that the package's shapes are structurally compatible with `@raindb/agent`'s wire shapes. Lives under `test/unit/` so `npm run test` covers them.

## Releasing

```sh
npm run lint         # tsc on src + test
npm run test         # Tier 1 + Tier 3
npm run build        # produces dist/
npm pack             # produces tarball; verify `tar tf <tarball>` contains only dist/, README.md, CHANGELOG.md
```

`package.json` has `private: true` for v0.1. Architect publishes to the registry; do not run `npm publish` from this repo without explicit authorization.

## Coordination

`~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md` is the live ledger. The substrate-side agent updates it when they ship a binding; this package's agent updates it when a stub swaps to live. Both columns must be kept in sync; the architect reviews drift weekly.

## Quality bar

Per the handoff doc: this package is what every future bolt author touches first. Bad types, broken IntelliSense, missing JSDoc, or shoddy error discrimination hurt every downstream bolt forever.

- Every exported method has JSDoc with summary + capability requirement + at least one `@example` + `@throws` covering each typed error it can produce.
- Every wrapper routes its catch path through `translateBindingError`. No untranslated errors leak.
- Every binding name string comes from `BINDING` in `internal/constants.ts`.
- The `setCtx(ctx)` requirement is documented in the README's quick start.
- Acceptance gate: `npm run lint && npm run test && npm run build && npm pack` all pass before any PR merges.
