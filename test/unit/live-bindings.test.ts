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
