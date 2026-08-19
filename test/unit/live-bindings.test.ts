// test/unit/live-bindings.test.ts -- happy-path coverage for every
// other LIVE binding wrapper (log, fetch, secrets, ids, jwt, crypto,
// cookies, iam, response).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setCtx,
  log,
  fetch,
  secrets,
  ids,
  jwt,
  crypto,
  cookies,
  iam,
  response,
  startSSE,
  RainDBBoltError,
} from '../../src/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

// ----------------------------- log -----------------------------

test('log.info forwards msg+fields to ctx.log.info', () => {
  let captured: {
    msg?: string;
    fields?: Record<string, unknown> | undefined;
  } = {};
  setCtx(
    mockCtx({
      log: {
        info: (msg: string, fields?: Record<string, unknown>) => {
          captured = { msg, fields };
        },
        warn: () => {},
        error: () => {},
      },
    }),
  );
  log.info('hello', { x: 1 });
  assert.equal(captured.msg, 'hello');
  assert.deepEqual(captured.fields, { x: 1 });
});

test('log.warn and log.error work the same way', () => {
  let warned = false;
  let errored = false;
  setCtx(
    mockCtx({
      log: {
        info: () => {},
        warn: () => {
          warned = true;
        },
        error: () => {
          errored = true;
        },
      },
    }),
  );
  log.warn('w');
  log.error('e');
  assert.equal(warned, true);
  assert.equal(errored, true);
});

// ----------------------------- fetch -----------------------------

test('fetch forwards url+init and returns response', async () => {
  let calledUrl: string | undefined;
  setCtx(
    mockCtx({
      fetch: async (url: string) => {
        calledUrl = url;
        return {
          status: 200,
          ok: true,
          headers: { 'content-type': 'text/plain' },
          body: 'pong',
          text: () => 'pong',
          json: () => ({ ok: true }),
        };
      },
    }),
  );
  const r = await fetch('https://example.com/ping');
  assert.equal(calledUrl, 'https://example.com/ping');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'pong');
});

test('fetch translates an Error to RainDBBoltError', async () => {
  setCtx(
    mockCtx({
      fetch: async () => {
        throw new Error('connection refused');
      },
    }),
  );
  await assert.rejects(
    () => fetch('https://example.com'),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.match((e as Error).message, /connection refused/);
      return true;
    },
  );
});

// ----------------------------- secrets -----------------------------

test('secrets.get forwards name', async () => {
  let captured = '';
  setCtx(
    mockCtx({
      secrets: {
        get: async (n: string) => {
          captured = n;
          return 'secret-value';
        },
      },
    }),
  );
  const out = await secrets.get('upstream-key');
  assert.equal(captured, 'upstream-key');
  assert.equal(out, 'secret-value');
});

// ----------------------------- ids -----------------------------

test('ids.uuidv7 returns the goja-side string', () => {
  setCtx(
    mockCtx({
      ids: { uuidv7: () => '018f-fixed-uuid' },
    }),
  );
  assert.equal(ids.uuidv7(), '018f-fixed-uuid');
});

// ----------------------------- jwt -----------------------------

test('jwt.sign forwards args and returns token', async () => {
  let captured: { name?: string; claims?: unknown; exp?: number } = {};
  setCtx(
    mockCtx({
      jwt: {
        sign: async (name: string, claims: unknown, exp: number) => {
          captured = { name, claims, exp };
          return 'signed.token.x';
        },
        verify: async () => ({}),
      },
    }),
  );
  const out = await jwt.sign('session-secret', { sub: 'u-1' }, 3600);
  assert.equal(captured.name, 'session-secret');
  assert.deepEqual(captured.claims, { sub: 'u-1' });
  assert.equal(captured.exp, 3600);
  assert.equal(out, 'signed.token.x');
});

test('jwt.verify forwards args and returns claims', async () => {
  setCtx(
    mockCtx({
      jwt: {
        sign: async () => 'x',
        verify: async (_n: string, t: string) => ({ tok: t }),
      },
    }),
  );
  const out = await jwt.verify('session-secret', 'abc');
  assert.deepEqual(out, { tok: 'abc' });
});

// ----------------------------- crypto -----------------------------

test('crypto.hashPassword + verifyPassword + randomBytes', async () => {
  setCtx(
    mockCtx({
      crypto: {
        hashPassword: async (p: string) => `hash(${p})`,
        verifyPassword: async (p: string, h: string) => h === `hash(${p})`,
        randomBytes: async (n?: number) => `r${n ?? 32}`,
      },
    }),
  );
  const h = await crypto.hashPassword('pw');
  assert.equal(h, 'hash(pw)');
  assert.equal(await crypto.verifyPassword('pw', h), true);
  assert.equal(await crypto.verifyPassword('wrong', h), false);
  assert.equal(await crypto.randomBytes(16), 'r16');
  assert.equal(await crypto.randomBytes(), 'r32');
});

// ----------------------------- cookies -----------------------------

test('cookies.parse and cookies.build', async () => {
  setCtx(
    mockCtx({
      cookies: {
        parse: (h: string) => ({ raw: h }),
        build: (n: string, v: string) => `${n}=${v}; Path=/`,
      },
    }),
  );
  const jar = await cookies.parse('a=1; b=2');
  assert.deepEqual(jar, { raw: 'a=1; b=2' });
  const sc = await cookies.build('session', 'tok');
  assert.equal(sc, 'session=tok; Path=/');
});

// ----------------------------- iam -----------------------------

test('iam.mintWireToken forwards opts', async () => {
  let captured: { subject?: string } = {};
  setCtx(
    mockCtx({
      iam: {
        mintWireToken: async (opts: { subject: string }) => {
          captured = { subject: opts.subject };
          return 'rgr1.signed';
        },
      },
    }),
  );
  const out = await iam.mintWireToken({
    subject: 'u-1',
    resources: [{ type: 'wire-key', id: 'tenants/t/x', ops: ['subscribe'] }],
    ttlSec: 3600,
  });
  assert.equal(captured.subject, 'u-1');
  assert.equal(out, 'rgr1.signed');
});

test('iam.mintActivitySubscription derives chain-head keys + mints', async () => {
  let capturedResources: Array<{ id: string }> = [];
  setCtx(
    mockCtx({
      iam: {
        mintWireToken: async (opts: { resources: Array<{ id: string }> }) => {
          capturedResources = opts.resources;
          return 'rgr1.activity';
        },
      },
    }),
  );
  const sub = await iam.mintActivitySubscription({
    subject: 'u-1',
    formationId: 'ref-entries',
    indexName: 'by-update',
    scopeValues: ['e-1', 'e-2'],
    ttlSec: 1800,
  });
  assert.equal(sub.token, 'rgr1.activity');
  // tenant-relative chain-head keys, one per scope
  assert.deepEqual(sub.keys, [
    'indexes/ref-entries/by-update.desc/e-1/latest.json',
    'indexes/ref-entries/by-update.desc/e-2/latest.json',
  ]);
  assert.equal(capturedResources.length, 2);
  assert.equal(capturedResources[0]?.id, 'indexes/ref-entries/by-update.desc/e-1/latest.json');
});

test('iam.mintActivitySubscription rejects an empty scopeValues list', async () => {
  setCtx(mockCtx({ iam: { mintWireToken: async () => 'x' } }));
  await assert.rejects(
    () =>
      iam.mintActivitySubscription({
        subject: 'u-1',
        formationId: 'f',
        indexName: 'by-update',
        scopeValues: [],
      }),
    (e: unknown) => e instanceof RainDBBoltError && /scopeValue/.test((e as Error).message),
  );
});

// ----------------------------- response (streaming) -----------------------------

test('response.write throws clearly when streaming not enabled', async () => {
  setCtx(mockCtx()); // no `response` field -- non-streaming route
  await assert.rejects(
    () => response.write('chunk'),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.match((e as Error).message, /streaming is not enabled/);
      return true;
    },
  );
});

test('response.write forwards chunk when streaming enabled', async () => {
  let captured = '';
  setCtx(
    mockCtx({
      response: {
        setHeader: () => {},
        beginStream: () => {},
        write: (c: string | Uint8Array) => {
          captured = typeof c === 'string' ? c : new TextDecoder().decode(c);
          return captured.length;
        },
      },
    }),
  );
  const n = await response.write('event: hello\ndata: x\n\n');
  assert.equal(captured, 'event: hello\ndata: x\n\n');
  assert.equal(n, captured.length);
});

test('response.setHeader and beginStream forward correctly', async () => {
  const events: string[] = [];
  setCtx(
    mockCtx({
      response: {
        setHeader: (n: string, v: string) => {
          events.push(`hdr:${n}=${v}`);
        },
        beginStream: (s?: number) => {
          events.push(`begin:${s ?? '?'}`);
        },
        write: () => 0,
      },
    }),
  );
  await response.setHeader('content-type', 'text/event-stream');
  await response.beginStream(200);
  assert.deepEqual(events, [
    'hdr:content-type=text/event-stream',
    'begin:200',
  ]);
});

// ----------------------------- startSSE helper -----------------------------

test('startSSE buffers frames + finalize returns the event-stream body (non-streaming route)', async () => {
  const ctx = mockCtx(); // no ctx.response -> buffered path
  setCtx(ctx);
  const sse = await startSSE(ctx);
  sse.send('thinking', { i: 1 });
  sse.send('final', { content: 'hi' });
  const res = sse.finalize();
  assert.equal(res.status, 200);
  assert.equal(res.headers?.['content-type'], 'text/event-stream');
  assert.match(res.body as string, /event: thinking\ndata: {"i":1}\n\n/);
  assert.match(res.body as string, /event: final\ndata: {"content":"hi"}\n\n/);
});

test('startSSE writes live + finalize returns empty body (streaming route)', async () => {
  const wire: string[] = [];
  const ctx = mockCtx({
    response: {
      setHeader: () => {},
      beginStream: () => {},
      write: (c: string | Uint8Array) => {
        wire.push(typeof c === 'string' ? c : new TextDecoder().decode(c));
        return 1;
      },
    },
  });
  setCtx(ctx);
  const sse = await startSSE(ctx);
  sse.send('tick', { n: 1 });
  const res = sse.finalize();
  // live path: bytes went to the wire, finalize body is empty
  assert.equal(res.body, '');
  assert.equal(wire.join(''), 'event: tick\ndata: {"n":1}\n\n');
});
