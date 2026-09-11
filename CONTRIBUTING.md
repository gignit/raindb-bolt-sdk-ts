# Contributing to @raindb/bolt-sdk

This SDK is for application authors using the RainDB Platform. Contributing
and running its local tests require no platform source checkout, administrator
profile, deployed test bolt, or internal testing framework.

## Local checks

Use Node.js 20 or newer and the dependencies declared in this repository:

```sh
npm ci
npm run lint
npm test
npm run build
```

The unit tests inject an in-memory context using `test/unit/_helpers.ts`.
They verify argument forwarding, results, errors, and pagination edge cases.
The shape tests under `test/unit/shape-compat/` use local structural types and
need no sibling checkout. These checks establish SDK behavior; they do not
claim to test a deployed service.

When adding a wrapper, test a successful call and its errors. Preserve omitted
options, explicitly supplied values, and the documented result shape. Use the
existing binding constants and error translation. Add examples demonstrating
the public API rather than requiring access to the service implementation.

For pagination, preserve the returned cursor unchanged. An empty result page
with `hasMore: true` can be valid; test continuation independently of the
number of returned items. Do not fabricate an end-of-results indication.

## Types and documentation

Keep JSDoc, README examples, and exported types consistent. State required
capabilities and unavailable operations explicitly. A declared TypeScript method
alone does not establish that an operation is available on the platform.

The package enables `exactOptionalPropertyTypes`. Build optional properties
conditionally when omission matters:

```ts
const opts: { formationId?: string } = {};
if (formationId !== undefined) opts.formationId = formationId;
```

Describe changes and their rationale in public API terms in comments, commits,
and pull requests. Include the commands used to verify them. Do not include
private service source, internal source coordinates, deployment details,
operator identities, or internal validation records.

## Examples and release checks

The example under `test/integration/example-bolt/` is application source, not
a deployed test runner. Its own `npm run typecheck` checks it separately.
Running an application requires your own tenant configuration and capabilities;
local SDK tests do not create or delete platform resources.

Keep `package.json` and the exported `VERSION` consistent when changing a
release version. Document breaking public contracts explicitly in the changelog.
Inspect the contents produced by `npm pack` before a release. Package publication
is a separate authorized action; do not change publication or license metadata
as part of a test or documentation fix.
