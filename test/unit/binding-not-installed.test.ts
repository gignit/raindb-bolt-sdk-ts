// test/unit/binding-not-installed.test.ts -- proves stubs throw the
// right error when the substrate-side binding is missing, AND
// dispatch through when it has shipped.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setCtx,
  BindingNotInstalled,
  sql,
  token,
  stats,
  objects,
  relay,
  vectors,
  catalog,
  formations,
  flows,
  files,
  actions,
  tags,
  db,
  RainDBBoltError,
} from '../../src/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

// ----- a stubbed binding throws BindingNotInstalled when not present -----

test('sql.query throws BindingNotInstalled when ctx.sql is missing', async () => {
  setCtx(mockCtx()); // no `sql` field
  await assert.rejects(
    () => sql.query({ sql: 'SELECT 1' }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.sql\.query is not installed/);
      assert.match((e as Error).message, /AUDIT_BOLT_SDK_GAPS\.md/);
      return true;
    },
  );
});

test('token.claim throws BindingNotInstalled when ctx.token is missing', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => token.claim('f', 's', { author: 'me' }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('stats.increment throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => stats.increment('f', 's', 'x'),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('objects.get throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => objects.get('bucket', 'key'),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('relay.read throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => relay.read({ formationId: 'f', scopeValue: 's' }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('vectors.query throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => vectors.query({ formationId: 'f', vector: [0.1, 0.2] }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('catalog.insert throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => catalog.insert({ formationId: 'f', path: '/a', scopeValue: 's' }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('formations.list throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => formations.list(),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('flows.queryState throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => flows.queryState({ formationId: 'f', flowId: 'fl', scopeValue: 's' }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('files.pushPublic throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () =>
      files.pushPublic({
        formationId: 'f',
        scopeValue: 's',
        fieldName: 'avatar',
        data: 'x',
        contentType: 'text/plain',
      }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('actions.dispatch throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => actions.dispatch('f', 'a', {}),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('tags.tag throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => tags.tag('f', 's', ['x']),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

test('db.listKeys (stub) throws BindingNotInstalled', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => db.listKeys({ formationId: 'f', indexId: 'i' }),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

// ----- when the substrate ships the binding, the stub dispatches through -----

test('sql.query dispatches through when ctx.sql.query is present', async () => {
  let dispatched = false;
  setCtx(
    mockCtx({
      // The cast is fine -- the BoltContext type has sql?: SqlBinding,
      // and we're providing one for this test.
      sql: {
        query: async () => {
          dispatched = true;
          return {
            columns: ['n'],
            rows: [{ n: 1 }],
            rowCount: 1,
            durationMs: 1,
            truncated: false,
          };
        },
      },
    }),
  );

  const out = await sql.query({ sql: 'SELECT 1 AS n' });
  assert.equal(dispatched, true);
  assert.equal(out.rowCount, 1);
});

test('a stubbed binding routes typed errors through translateBindingError', async () => {
  const native = new Error('scope held');
  native.name = 'TokenExists';
  setCtx(
    mockCtx({
      token: {
        claim: async () => {
          throw native;
        },
      },
    }),
  );

  await assert.rejects(
    () => token.claim('f', 's', { author: 'me' }),
    (e: unknown) => {
      // TokenExists from the @raindb/bolt-sdk error family
      assert.ok(e instanceof RainDBBoltError);
      assert.equal((e as Error).name, 'TokenExists');
      return true;
    },
  );
});
