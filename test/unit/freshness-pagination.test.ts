import test from 'node:test';
import assert from 'node:assert/strict';
import { setCtx, sql } from '../../src/index.js';
import { mockCtx } from './_helpers.js';

const snapshot = '01990000-0000-7000-8000-000000000001';
const watermark = '01990000-0000-7000-8000-000000000003';
const input = { sql: 'SELECT entryId FROM entity."notes"', formationId: 'notes', scopeKey: 'entryId' };

function usePages(pages: unknown[], expectedCursors?: string[]) {
  let calls = 0;
  const ctx = mockCtx({ sql: { query: async () => ({
    columns: ['entryId'], rows: [], rowCount: 0, durationMs: 0, truncated: false,
    latest: [{ formationId: 'notes', freshnessStatus: 'BEHIND', snapshotDropletId: snapshot, currentDropletId: watermark }],
  }) } as never });
  ctx.db.listSince = async (_formationId, cursor) => {
    assert.ok(calls < pages.length, 'must not fetch beyond the supplied pages');
    if (expectedCursors) assert.equal(cursor, expectedCursors[calls]);
    return pages[calls++] as never;
  };
  setCtx(ctx);
  return () => calls;
}

for (const nextCursor of [undefined, '', snapshot]) {
  test(`freshness rejects hasMore without an advancing cursor: ${String(nextCursor)}`, async () => {
    usePages([{ droplets: [{ dropletId: watermark, payload: { entryId: 'new' } }], hasMore: true, nextCursor }]);
    await assert.rejects(() => sql.queryEntityRowsFresh(input), /cursor/i);
  });
}

test('freshness accepts final cursor coverage when the watermark entity was skipped', async () => {
  const calls = usePages([{ droplets: [], hasMore: false, nextCursor: watermark }]);
  const result = await sql.queryEntityRowsFresh(input);
  assert.deepEqual(result.rows, []);
  assert.equal(calls(), 1);
});

test('freshness follows an empty tombstone page before the final data page', async () => {
  const calls = usePages([
    { droplets: [], hasMore: true, nextCursor: '01990000-0000-7000-8000-000000000002' },
    { droplets: [{ dropletId: watermark, payload: { entryId: 'new' } }], hasMore: false, nextCursor: watermark },
  ]);
  assert.deepEqual((await sql.queryEntityRowsFresh(input)).rows, [{ entryId: 'new' }]);
  assert.equal(calls(), 2);
});

test('freshness accepts the producer relative-key continuation without rewriting it', async () => {
  const calls = usePages([
    { droplets: [], hasMore: true, nextCursor: `${watermark}/latest.json` },
    { droplets: [], hasMore: false },
  ], [snapshot, `${watermark}/latest.json`]);
  assert.deepEqual((await sql.queryEntityRowsFresh(input)).rows, []);
  assert.equal(calls(), 2);
});

test('an earlier relative-key cursor does not cover a newer watermark', async () => {
  usePages([
    { droplets: [], hasMore: true, nextCursor: `${snapshot}/latest.json` },
    { droplets: [], hasMore: false },
  ]);
  await assert.rejects(() => sql.queryEntityRowsFresh(input), /current watermark/);
});
