# Changelog

Changes are described in terms of the public SDK contract. Version numbers
identify SDK releases; a declared wrapper still requires runtime availability
and the capabilities documented for the operation.

## Unreleased

- Update development tooling to TypeScript 7.0.2, tsx 4.23.13, and Node type
  declarations 22.20.2 in the SDK and example. Explicitly load Node declarations
  for TypeScript 7's new ambient-type defaults; retain the ES2022 output target.
- Refresh both lockfiles to esbuild 0.28.2, including the fix for
  [GHSA-g7r4-m6w7-qqqr](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr).
- Preserve `listSince` availability and returned continuation cursors when
  checking freshness. Valid empty pages can continue; missing or stalled
  continuation cannot be accepted as complete. Include final cursor coverage.
- Make contributor checks independently runnable and remove an unimplemented
  deployment-test placeholder.
- Remove service implementation references from documentation and missing-binding
  diagnostics while preserving typed errors and binding metadata.

## [0.7.0] - 2026-08-12

- Add `freshnessStatus` to SQL freshness bookmarks with `CURRENT`, `BEHIND`,
  `UNKNOWN`, and `UNAVAILABLE` values.
- Export `isBehind`, `isFresh`, and `needsHarvest` helpers.
- Subsequent corrections carry optional `planStrategy: 'range' | 'scan'` through
  SQL wrappers and agent requests, preserve scoped listing options, and return
  supported token-write scope values.
- Reject unavailable or incomplete freshness evidence. The entity-row freshness
  helper does not reapply SQL predicates, sorting, or limits after merging.
- Describe `reserveDownload` as buffered bytes, without fabricated expiry.

## [0.6.0] - 2026-07-24

- Extend agent-bridge routing for supported listing, SQL, tagging, and expiration
  operations, preserving the requested operation's input and result contract.
- Refresh available-binding documentation and missing-binding diagnostics.

## [0.5.0] - 2026-07-24

- Add `db.mutate`, `db.mutateAndRead`, and `db.writeToken` wrappers for atomic
  token operations, with the corresponding capabilities and result types.

## [0.4.0]

- Add per-request authentication and permission bindings through `ctx.auth`.

## [0.3.0] - 2026-05-31

- Add tagging, expiration, batch-write, and scheduled-callback wrappers.
- Extend typed examples and unit coverage for these operations.

## [0.2.0] - 2026-05-31

- Add object access, key listing, incremental listing, and SQL wrappers.
- Extend examples, result types, and error tests.

## [0.1.0] - 2026-05-30

- Introduce typed bolt contexts, binding wrappers, errors, and optional
  `@raindb/agent` integration.
- Add local unit and structural type tests plus example application source.
- Expose unavailable operations explicitly through `BindingNotInstalled`.
