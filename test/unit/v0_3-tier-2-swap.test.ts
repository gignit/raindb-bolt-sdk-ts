// test/unit/v0_3-tier-2-swap.test.ts -- unit tests for the four
// stubs that were swapped to LIVE in v0.3.0:
//
//   - ctx.db.{tag,untag}                   (substrate commit eee3eac)
//   - ctx.db.{expire,expirationDays}       (substrate commit eee3eac)
//   - ctx.db.writeBatch                    (substrate commit eee3eac)
//   - ctx.schedule                         (substrate commit f934956)
//
// Per handoff §L acceptance: each newly-LIVE binding gets
//   (1) a happy-path test (mock substrate returns expected shape;
//       wrapper translates correctly),
//   (2) a capability-error test (mock substrate throws the canonical
//       capability-denial pattern; wrapper produces CapabilityDenied
//       -- except for ctx.schedule whose denial format is bolt-level
//       and does NOT match the formation-shape regex; it surfaces as
//       a plain RainDBBoltError),
//   (3) a binding-missing test (substrate namespace absent; wrapper
//       throws BindingNotInstalled with the expected message hints).
//
// Mirrors the v0.2.0 swap-test file's structure (see
// test/unit/v0_2-tier-1-swap.test.ts) so the codebase has a single
// recognizable pattern for verifying a stub-to-LIVE swap.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setCtx,
  db,
  tags,
  schedule,
  BindingNotInstalled,
  CapabilityDenied,
  RainDBBoltError,
} from '../../src/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

// ============================================================
// ctx.db.tag (audit §L Gap 7; substrate commit eee3eac)
// ============================================================

test('db.tag forwards (formationId, scopeValue, tags) positionally', async () => {
  let captured: { f?: string; s?: string; t?: Record<string, string> } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        tag: async (f: string, s: string, t: Record<string, string>) => {
          captured = { f, s, t };
        },
      },
    }),
  );
  await db.tag({
    formationId: 'agent-graph',
    scopeValue: 'a-018f',
    tags: { env: 'prod', tier: 'gold' },
  });
  assert.equal(captured.f, 'agent-graph');
  assert.equal(captured.s, 'a-018f');
  assert.deepEqual(captured.t, { env: 'prod', tier: 'gold' });
});

test('db.tag translates capability denial to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        tag: async () => {
          throw new Error(
            'ctx.db.tag: tag on formation "agent-graph" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () =>
      db.tag({
        formationId: 'agent-graph',
        scopeValue: 'a-1',
        tags: { x: 'y' },
      }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'tag');
      assert.equal((e as CapabilityDenied).formationId, 'agent-graph');
      assert.equal((e as CapabilityDenied).binding, 'ctx.db.tag');
      return true;
    },
  );
});

test('db.tag throws BindingNotInstalled on pre-eee3eac runtime', async () => {
  setCtx(mockCtx()); // default mockCtx omits db.tag
  await assert.rejects(
    () =>
      db.tag({ formationId: 'f', scopeValue: 's', tags: { a: 'b' } }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.db\.tag/);
      assert.match((e as Error).message, /eee3eac/);
      return true;
    },
  );
});

// ============================================================
// ctx.db.untag (audit §L Gap 7; substrate commit eee3eac)
// ============================================================

test('db.untag forwards (formationId, scopeValue, tagKeys) positionally', async () => {
  let captured: { f?: string; s?: string; k?: string[] } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        untag: async (f: string, s: string, k: string[]) => {
          captured = { f, s, k };
        },
      },
    }),
  );
  await db.untag({
    formationId: 'agent-graph',
    scopeValue: 'a-018f',
    tagKeys: ['tier', 'staging'],
  });
  assert.equal(captured.f, 'agent-graph');
  assert.equal(captured.s, 'a-018f');
  assert.deepEqual(captured.k, ['tier', 'staging']);
});

test('db.untag translates capability denial', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        untag: async () => {
          throw new Error(
            'ctx.db.untag: tag on formation "agent-graph" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () =>
      db.untag({
        formationId: 'agent-graph',
        scopeValue: 'a-1',
        tagKeys: ['x'],
      }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'tag');
      assert.equal((e as CapabilityDenied).binding, 'ctx.db.untag');
      return true;
    },
  );
});

test('db.untag throws BindingNotInstalled on pre-eee3eac runtime', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () =>
      db.untag({ formationId: 'f', scopeValue: 's', tagKeys: ['x'] }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.db\.untag/);
      assert.match((e as Error).message, /eee3eac/);
      return true;
    },
  );
});

// ============================================================
// The ergonomic tags.* namespace re-routes to db.tag/db.untag
// ============================================================

test('tags.tag (3-arg form) re-routes through ctx.db.tag', async () => {
  let captured: { f?: string; s?: string; t?: Record<string, string> } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        tag: async (f: string, s: string, t: Record<string, string>) => {
          captured = { f, s, t };
        },
      },
    }),
  );
  await tags.tag('continuum', 'global', { env: 'prod' });
  assert.equal(captured.f, 'continuum');
  assert.equal(captured.s, 'global');
  assert.deepEqual(captured.t, { env: 'prod' });
});

test('tags.untag (3-arg form) re-routes through ctx.db.untag', async () => {
  let captured: { f?: string; s?: string; k?: string[] } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        untag: async (f: string, s: string, k: string[]) => {
          captured = { f, s, k };
        },
      },
    }),
  );
  await tags.untag('continuum', 'global', ['env']);
  assert.equal(captured.f, 'continuum');
  assert.equal(captured.s, 'global');
  assert.deepEqual(captured.k, ['env']);
});

test('tags.replaceTags stays STUBBED (no substrate binding)', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () =>
      tags.replaceTags('continuum', 'global', { a: 'b' }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.tags\.replaceTags/);
      return true;
    },
  );
});

// ============================================================
// ctx.db.expire (audit §M Gap 8; substrate commit eee3eac)
// ============================================================

test('db.expire forwards (formationId, scopeValue) positionally', async () => {
  let called: { f?: string; s?: string } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        expire: async (f: string, s: string) => {
          called = { f, s };
        },
      },
    }),
  );
  await db.expire({ formationId: 'agent-graph', scopeValue: 'a-1' });
  assert.deepEqual(called, { f: 'agent-graph', s: 'a-1' });
});

test('db.expire translates capability denial to CapabilityDenied with op="expire"', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        expire: async () => {
          throw new Error(
            'ctx.db.expire: expire on formation "agent-graph" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () => db.expire({ formationId: 'agent-graph', scopeValue: 'a-1' }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'expire');
      assert.equal((e as CapabilityDenied).formationId, 'agent-graph');
      assert.equal((e as CapabilityDenied).binding, 'ctx.db.expire');
      return true;
    },
  );
});

test('db.expire throws BindingNotInstalled on pre-eee3eac runtime', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => db.expire({ formationId: 'f', scopeValue: 's' }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.db\.expire/);
      assert.match((e as Error).message, /eee3eac/);
      return true;
    },
  );
});

// ============================================================
// ctx.db.expirationDays (audit §M Gap 8; substrate commit eee3eac)
// ============================================================

test('db.expirationDays takes no args and returns number (sync substrate value)', async () => {
  let called = false;
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        // The substrate's installer surfaces this as a synchronous
        // value (s.rt.ToValue(db.ExpirationDays())). The wrapper
        // normalizes both sync and Promise returns to a Promise.
        expirationDays: () => {
          called = true;
          return 90;
        },
      },
    }),
  );
  const days = await db.expirationDays();
  assert.equal(called, true);
  assert.equal(days, 90);
});

test('db.expirationDays returns 0 when no retention rule is configured', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        expirationDays: () => 0,
      },
    }),
  );
  assert.equal(await db.expirationDays(), 0);
});

test('db.expirationDays throws BindingNotInstalled on pre-eee3eac runtime', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => db.expirationDays(),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.db\.expirationDays/);
      assert.match((e as Error).message, /eee3eac/);
      return true;
    },
  );
});

// ============================================================
// ctx.db.writeBatch (audit §I Gap 4; substrate commit eee3eac)
// ============================================================

test('db.writeBatch forwards (formationId, items, opts) and projects result shape', async () => {
  let calledF: string | undefined;
  let calledItems: unknown;
  let calledOpts:
    | { idempotencyKey?: string; triggerFlows?: boolean; maxConcurrency?: number }
    | undefined;
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        writeBatch: async (f, items, opts) => {
          calledF = f;
          calledItems = items;
          calledOpts = opts;
          return {
            total: 2,
            succeeded: 1,
            failed: 1,
            items: [
              {
                index: 0,
                dropletId: 'd-1',
                scopeValue: 'a-1',
                pathsWritten: ['agent-graph/a-1/d-1.json'],
              },
              {
                index: 1,
                pathsWritten: [],
                error: 'conflict',
              },
            ],
          };
        },
      },
    }),
  );

  const r = await db.writeBatch({
    formationId: 'agent-graph',
    items: [
      { payload: { agentId: 'a-1', name: 'Bot' } },
      { payload: { agentId: 'a-2', name: 'Bee' }, idempotencyKey: 'a-2-init' },
    ],
    opts: { idempotencyKey: 'agents-init-v1', triggerFlows: true },
  });

  assert.equal(calledF, 'agent-graph');
  assert.deepEqual(calledItems, [
    { payload: { agentId: 'a-1', name: 'Bot' } },
    { payload: { agentId: 'a-2', name: 'Bee' }, idempotencyKey: 'a-2-init' },
  ]);
  assert.deepEqual(calledOpts, {
    idempotencyKey: 'agents-init-v1',
    triggerFlows: true,
  });

  assert.equal(r.total, 2);
  assert.equal(r.succeeded, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.items[0]?.dropletId, 'd-1');
  assert.equal(r.items[0]?.error, undefined);
  assert.equal(r.items[1]?.error, 'conflict');
  assert.equal(r.items[1]?.dropletId, undefined);
});

test('db.writeBatch surfaces partial-success (failed > 0 without rejection)', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        writeBatch: async () => ({
          total: 3,
          succeeded: 2,
          failed: 1,
          items: [
            { index: 0, dropletId: 'd-0', pathsWritten: ['p0'] },
            { index: 1, dropletId: 'd-1', pathsWritten: ['p1'] },
            { index: 2, pathsWritten: [], error: 'schema validation' },
          ],
        }),
      },
    }),
  );
  const r = await db.writeBatch({
    formationId: 'f',
    items: [
      { payload: {} },
      { payload: {} },
      { payload: {} },
    ],
  });
  // Partial success is NOT a thrown rejection -- the caller iterates
  // r.items[i].error to discriminate.
  assert.equal(r.total, 3);
  assert.equal(r.failed, 1);
  const failures = r.items.filter((it) => it.error !== undefined);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.index, 2);
});

test('db.writeBatch translates capability denial to CapabilityDenied with op="write"', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        writeBatch: async () => {
          throw new Error(
            'ctx.db.writeBatch: write on formation "agent-graph" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () =>
      db.writeBatch({
        formationId: 'agent-graph',
        items: [{ payload: { x: 1 } }],
      }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'write');
      assert.equal((e as CapabilityDenied).formationId, 'agent-graph');
      assert.equal((e as CapabilityDenied).binding, 'ctx.db.writeBatch');
      return true;
    },
  );
});

test('db.writeBatch throws BindingNotInstalled on pre-eee3eac runtime', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () =>
      db.writeBatch({
        formationId: 'f',
        items: [{ payload: { x: 1 } }],
      }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.db\.writeBatch/);
      assert.match((e as Error).message, /eee3eac/);
      return true;
    },
  );
});

// ============================================================
// ctx.schedule (Wave 2.5; substrate commit f934956)
// ============================================================

test('schedule.schedule forwards (formationId, runAfterMs, actionRef, payload) and returns event key', async () => {
  let capturedF: string | undefined;
  let capturedRunAfterMs: number | undefined;
  let capturedA: string | undefined;
  let capturedP: Record<string, unknown> | null | undefined;
  setCtx(
    mockCtx({
      schedule: async (f, runAfterMs, a, p) => {
        capturedF = f;
        capturedRunAfterMs = runAfterMs;
        capturedA = a;
        capturedP = p;
        return 's/scheduled/2026/05/31/01h23m45s-AAAA-evt-018f';
      },
    }),
  );
  const eventKey = await schedule.schedule({
    formationId: 'agent-review-request',
    runAfterMs: 1_900_000_000_000,
    actionRef: 'settle-review-deadline',
    payload: { requestId: 'rev-123' },
  });
  assert.equal(capturedF, 'agent-review-request');
  assert.equal(capturedRunAfterMs, 1_900_000_000_000);
  assert.equal(capturedA, 'settle-review-deadline');
  assert.deepEqual(capturedP, { requestId: 'rev-123' });
  assert.match(eventKey, /^s\/scheduled\//);
});

test('schedule.schedule accepts a null payload', async () => {
  let capturedPayload: unknown = 'unset';
  setCtx(
    mockCtx({
      schedule: async (_f, _r, _a, p) => {
        capturedPayload = p;
        return 's/scheduled/x';
      },
    }),
  );
  await schedule.schedule({
    formationId: 'f',
    runAfterMs: 1_000,
    actionRef: 'a',
    // Omit payload entirely -- the wrapper coerces to null for the
    // substrate (which accepts null/undefined/object).
  });
  assert.equal(capturedPayload, null);
});

test('schedule.schedule surfaces substrate capability-denial as RainDBBoltError (bolt-level, not formation-scoped)', async () => {
  setCtx(
    mockCtx({
      schedule: async () => {
        // The substrate-side denial format for bolt-level ops does
        // NOT match the formation-shape CAPABILITY_DENIAL_REGEX.
        // The wrapper falls through to a plain RainDBBoltError with
        // the original message preserved.
        throw new Error(
          'ctx.schedule: schedule capability not declared (set capabilities.raindb.schedule=true in the bolt manifest)',
        );
      },
    }),
  );
  await assert.rejects(
    () =>
      schedule.schedule({
        formationId: 'f',
        runAfterMs: 1,
        actionRef: 'a',
      }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.ok(!(e instanceof CapabilityDenied));
      assert.equal((e as RainDBBoltError).binding, 'ctx.schedule');
      assert.match(
        (e as Error).message,
        /schedule capability not declared/,
      );
      return true;
    },
  );
});

test('schedule.schedule throws BindingNotInstalled when ctx.schedule absent (pre-f934956)', async () => {
  setCtx(mockCtx()); // default mockCtx omits schedule
  await assert.rejects(
    () =>
      schedule.schedule({
        formationId: 'f',
        runAfterMs: 1,
        actionRef: 'a',
      }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.schedule/);
      assert.match((e as Error).message, /f934956/);
      assert.match(
        (e as Error).message,
        /capabilities\.raindb\.schedule/,
      );
      return true;
    },
  );
});
