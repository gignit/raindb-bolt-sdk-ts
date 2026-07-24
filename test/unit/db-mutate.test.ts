// test/unit/db-mutate.test.ts -- unit tests for the atomic token
// read-modify-write bindings added to ctx.db:
//
//   - ctx.db.mutate(formationId, scopeValue, ops)
//   - ctx.db.mutateAndRead(formationId, scopeValue, ops, readPaths)
//   - ctx.db.writeToken(formationId, payload)
//
// Substrate installer: pkg/lightning/engines/goja/bindings.go::
// installDBBinding. Capability gate (host-side): OpMutate ("mutate")
// for mutate/mutateAndRead, OpTokenWrite ("token-write") for writeToken.
//
// Each binding gets:
//   (1) happy-path: mock substrate returns the expected shape; the
//       wrapper forwards positional args + translates the result.
//   (2) capability-denial: mock throws the canonical denial pattern;
//       the wrapper produces CapabilityDenied.
//   (3) binding-missing: substrate method absent; the wrapper throws
//       BindingNotInstalled.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setCtx,
  db,
  BindingNotInstalled,
  CapabilityDenied,
} from '../../src/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

// The four base DbBinding methods every `db` override must carry
// (BoltContext.db is required and non-partial). Spread this into each
// override so the test only declares the method under test.
const dbBase = {
  readLatest: async () => null,
  readDroplet: async () => null,
  writeDroplet: async () => ({ dropletId: 'x' }),
  listDroplets: async () => [],
};

// ============================================================
// ctx.db.mutate
// ============================================================

test('db.mutate forwards (formationId, scopeValue, ops) positionally', async () => {
  let captured: { f?: string; s?: string; ops?: unknown } = {};
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        mutate: async (f: string, s: string, ops: unknown) => {
          captured = { f, s, ops };
        },
      },
    }),
  );

  await db.mutate({
    formationId: 'invite-quota',
    scopeValue: 'tenant-1',
    ops: [{ kind: 'increment', path: 'used', by: 1 }],
  });

  assert.equal(captured.f, 'invite-quota');
  assert.equal(captured.s, 'tenant-1');
  assert.deepEqual(captured.ops, [{ kind: 'increment', path: 'used', by: 1 }]);
});

test('db.mutate translates capability denial to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        mutate: async () => {
          throw new Error(
            'ctx.db.mutate: mutate on formation "invite-quota" not declared in capabilities',
          );
        },
      },
    }),
  );

  await assert.rejects(
    db.mutate({
      formationId: 'invite-quota',
      scopeValue: 'tenant-1',
      ops: [{ kind: 'increment', path: 'used', by: 1 }],
    }),
    CapabilityDenied,
  );
});

test('db.mutate throws BindingNotInstalled when ctx.db.mutate absent', async () => {
  setCtx(mockCtx({ db: { ...dbBase } }));
  await assert.rejects(
    db.mutate({
      formationId: 'invite-quota',
      scopeValue: 'tenant-1',
      ops: [{ kind: 'set', path: 'k', value: 1 }],
    }),
    BindingNotInstalled,
  );
});

// ============================================================
// ctx.db.mutateAndRead
// ============================================================

test('db.mutateAndRead forwards args and returns the post-mutation values', async () => {
  let captured: { f?: string; s?: string; ops?: unknown; rp?: unknown } = {};
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        mutateAndRead: async (
          f: string,
          s: string,
          ops: unknown,
          readPaths: unknown,
        ) => {
          captured = { f, s, ops, rp: readPaths };
          return { used: 3 };
        },
      },
    }),
  );

  const now = 1_700_000_000_000;
  const vals = await db.mutateAndRead({
    formationId: 'invite-quota',
    scopeValue: 'tenant-1',
    ops: [
      {
        kind: 'windowIncrement',
        countPath: 'used',
        windowStartPath: 'windowStartMs',
        windowMs: 2_592_000_000,
        by: 1,
        nowMs: now,
      },
    ],
    readPaths: ['used'],
  });

  assert.equal(captured.f, 'invite-quota');
  assert.equal(captured.s, 'tenant-1');
  assert.deepEqual(captured.rp, ['used']);
  assert.deepEqual(captured.ops, [
    {
      kind: 'windowIncrement',
      countPath: 'used',
      windowStartPath: 'windowStartMs',
      windowMs: 2_592_000_000,
      by: 1,
      nowMs: now,
    },
  ]);
  assert.equal(vals.used, 3);
});

test('db.mutateAndRead translates capability denial to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        mutateAndRead: async () => {
          throw new Error(
            'ctx.db.mutateAndRead: mutate on formation "invite-quota" not declared in capabilities',
          );
        },
      },
    }),
  );

  await assert.rejects(
    db.mutateAndRead({
      formationId: 'invite-quota',
      scopeValue: 'tenant-1',
      ops: [{ kind: 'increment', path: 'used', by: -1 }],
      readPaths: ['used'],
    }),
    CapabilityDenied,
  );
});

test('db.mutateAndRead throws BindingNotInstalled when absent', async () => {
  setCtx(mockCtx({ db: { ...dbBase } }));
  await assert.rejects(
    db.mutateAndRead({
      formationId: 'invite-quota',
      scopeValue: 'tenant-1',
      ops: [{ kind: 'increment', path: 'used', by: -1 }],
      readPaths: ['used'],
    }),
    BindingNotInstalled,
  );
});

// ============================================================
// ctx.db.writeToken
// ============================================================

test('db.writeToken forwards (formationId, payload) and returns envelope', async () => {
  let captured: { f?: string; p?: unknown } = {};
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        writeToken: async (f: string, p: Record<string, unknown>) => {
          captured = { f, p };
          return { dropletId: 'tok-018f' };
        },
      },
    }),
  );

  const env = await db.writeToken({
    formationId: 'invite-quota',
    payload: { tenantId: 'tenant-1', used: 0 },
  });

  assert.equal(captured.f, 'invite-quota');
  assert.deepEqual(captured.p, { tenantId: 'tenant-1', used: 0 });
  assert.equal(env.dropletId, 'tok-018f');
});

test('db.writeToken throws when substrate returns wrong shape', async () => {
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        // Deliberately-wrong shape: no dropletId string. Cast through
        // unknown so the test can feed the wrapper a malformed result.
        writeToken: (async () => ({ notADropletId: true })) as unknown as (
          formationId: string,
          payload: Record<string, unknown>,
        ) => Promise<{ dropletId: string }>,
      },
    }),
  );

  await assert.rejects(
    db.writeToken({ formationId: 'invite-quota', payload: { k: 1 } }),
  );
});

test('db.writeToken translates capability denial to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      db: {
        ...dbBase,
        writeToken: async () => {
          throw new Error(
            'ctx.db.writeToken: token-write on formation "invite-quota" not declared in capabilities',
          );
        },
      },
    }),
  );

  await assert.rejects(
    db.writeToken({ formationId: 'invite-quota', payload: { k: 1 } }),
    CapabilityDenied,
  );
});

test('db.writeToken throws BindingNotInstalled when absent', async () => {
  setCtx(mockCtx({ db: { ...dbBase } }));
  await assert.rejects(
    db.writeToken({ formationId: 'invite-quota', payload: { k: 1 } }),
    BindingNotInstalled,
  );
});
