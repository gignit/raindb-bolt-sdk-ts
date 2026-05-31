// test/e2e.test.ts -- end-to-end integration test.
//
// This test deploys the example-bolt to devz and exercises every
// LIVE binding through real HTTP requests. It gates itself behind
// the RAINDB_DEVZ_PROFILE env var: when that variable isn't set,
// the test skips with a clear message (per handoff §L Tier 2
// acceptance).
//
// When RAINDB_DEVZ_PROFILE is set, the runner expects:
//   - raindb-cli on PATH, configured for the named devz profile
//   - the bolt's manifest deployable as-is (no per-tenant rewrites)
//   - the formations declared in bolt.json (agent-graph) exist on
//     the test tenant
//
// v0.1 ships the harness STUBBED: the actual deploy/teardown logic
// is documented but TODO. Bolts authors who want to run the e2e
// suite locally can fill in the deploy step (or wait for v0.2 when
// it's wired up). The compile-only proof of the example-bolt is
// already covered by `npm run typecheck` from the repo root.

import { test } from 'node:test';

const PROFILE = process.env['RAINDB_DEVZ_PROFILE'] ?? '';

test('example-bolt e2e (skipped without RAINDB_DEVZ_PROFILE)', { skip: PROFILE === '' }, async (t) => {
  // TODO(v0.2): wire the deploy harness.
  //
  // 1. raindb-cli lightning bolt deploy --profile=$PROFILE \
  //      --manifest=./bolt.json --src=./dist
  // 2. Capture the deployed URL from the response.
  // 3. POST/GET each route, assert response shapes.
  // 4. raindb-cli lightning bolt undeploy --profile=$PROFILE \
  //      --bolt-id=bolt-sdk-example
  //
  // For v0.1 the harness is documented but not implemented.
  // The example-bolt's value at v0.1 is the COMPILE-time proof that
  // the SDK's types work in a real bolt-shaped file.
  t.diagnostic(
    'e2e harness not yet wired (v0.1). The example-bolt compiles cleanly and demonstrates the canonical shape.',
  );
});
