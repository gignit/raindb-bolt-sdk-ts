// test/unit/errors.test.ts -- typed error classes + translateBindingError.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RainDBBoltError,
  CapabilityDenied,
  BindingNotInstalled,
  TokenExists,
  TokenExpired,
  ConditionFailed,
  StatsValidation,
  AuthorRequired,
  translateBindingError,
} from '../../src/index.js';

// ----------------------------- class hierarchy -----------------------------

test('every typed error inherits from RainDBBoltError', () => {
  const samples = [
    new CapabilityDenied('f', 'read'),
    new BindingNotInstalled('msg'),
    new TokenExists('msg'),
    new TokenExpired('msg'),
    new ConditionFailed('msg'),
    new StatsValidation('msg'),
    new AuthorRequired('msg'),
  ];
  for (const s of samples) {
    assert.ok(s instanceof RainDBBoltError, `${s.name} not a RainDBBoltError`);
    assert.ok(s instanceof Error, `${s.name} not an Error`);
  }
});

test('CapabilityDenied carries formationId and op', () => {
  const e = new CapabilityDenied('agent-graph', 'read', {
    binding: 'ctx.db.readLatest',
  });
  assert.equal(e.formationId, 'agent-graph');
  assert.equal(e.op, 'read');
  assert.equal(e.binding, 'ctx.db.readLatest');
  assert.equal(e.name, 'CapabilityDenied');
  assert.match(e.message, /read on formation "agent-graph"/);
});

test('TokenExists carries optional formationId and scopeValue', () => {
  const e = new TokenExists('claimed', {
    formationId: 'continuum-stats',
    scopeValue: 'global',
    binding: 'ctx.token.claim',
  });
  assert.equal(e.formationId, 'continuum-stats');
  assert.equal(e.scopeValue, 'global');
  assert.equal(e.binding, 'ctx.token.claim');
});

test('RainDBBoltError omits optional fields when not provided', () => {
  const e = new RainDBBoltError('plain');
  // exactOptionalPropertyTypes: undefined means "absent" so the field
  // should not be enumerable / not equal to undefined. Sanity check.
  assert.equal(e.binding, undefined);
  assert.equal(e.input, undefined);
});

// ----------------------------- translateBindingError -----------------------------

test('translateBindingError preserves typed errors', () => {
  const original = new TokenExists('already claimed');
  assert.throws(
    () => translateBindingError(original, { binding: 'ctx.token.claim' }),
    (e: unknown) => e === original,
  );
});

test('translateBindingError maps Error.name=TokenExists to TokenExists', () => {
  const native = new Error('scope held');
  native.name = 'TokenExists';
  assert.throws(
    () => translateBindingError(native, { binding: 'ctx.token.claim' }),
    (e: unknown) => {
      assert.ok(e instanceof TokenExists);
      assert.equal((e as TokenExists).message, 'scope held');
      assert.equal((e as TokenExists).binding, 'ctx.token.claim');
      return true;
    },
  );
});

test('translateBindingError preserves formationId/scopeValue stamped on Error', () => {
  const native = new Error('held') as Error & {
    formationId?: string;
    scopeValue?: string;
  };
  native.name = 'TokenExists';
  native.formationId = 'continuum-stats';
  native.scopeValue = 'global';
  assert.throws(
    () => translateBindingError(native, { binding: 'ctx.token.claim' }),
    (e: unknown) => {
      assert.ok(e instanceof TokenExists);
      assert.equal((e as TokenExists).formationId, 'continuum-stats');
      assert.equal((e as TokenExists).scopeValue, 'global');
      return true;
    },
  );
});

test('translateBindingError maps each typed name', () => {
  const cases: Array<{ name: string; cls: typeof RainDBBoltError }> = [
    { name: 'TokenExpired', cls: TokenExpired },
    { name: 'ConditionFailed', cls: ConditionFailed },
    { name: 'StatsValidation', cls: StatsValidation },
    { name: 'AuthorRequired', cls: AuthorRequired },
  ];
  for (const c of cases) {
    const native = new Error('msg');
    native.name = c.name;
    assert.throws(
      () => translateBindingError(native, { binding: 'ctx.test' }),
      (e: unknown) => {
        assert.ok(
          e instanceof c.cls,
          `expected ${c.name} -> ${c.cls.name}`,
        );
        return true;
      },
    );
  }
});

test('translateBindingError parses capability-denial messages', () => {
  const cases = [
    {
      msg: 'ctx.db: read on formation "agent-graph" not declared in capabilities',
      formation: 'agent-graph',
      op: 'read',
    },
    {
      msg: 'ctx.objects: object-write on formation "uploads" not declared in capabilities',
      formation: 'uploads',
      op: 'object-write',
    },
    {
      msg: 'ctx.relay.write: relay-write on formation "wf" not declared in capabilities',
      formation: 'wf',
      op: 'relay-write',
    },
  ];
  for (const c of cases) {
    const native = new Error(c.msg);
    assert.throws(
      () => translateBindingError(native, { binding: 'ctx.x' }),
      (e: unknown) => {
        assert.ok(e instanceof CapabilityDenied);
        assert.equal((e as CapabilityDenied).formationId, c.formation);
        assert.equal((e as CapabilityDenied).op, c.op);
        return true;
      },
    );
  }
});

test('translateBindingError falls back to RainDBBoltError for unknown errors', () => {
  const native = new Error('something broke');
  assert.throws(
    () => translateBindingError(native, { binding: 'ctx.x', input: { a: 1 } }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.ok(!(e instanceof CapabilityDenied));
      assert.equal((e as RainDBBoltError).message, 'something broke');
      assert.equal((e as RainDBBoltError).binding, 'ctx.x');
      return true;
    },
  );
});

test('translateBindingError handles non-Error throws', () => {
  assert.throws(
    () => translateBindingError('a string', { binding: 'ctx.x' }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.equal((e as RainDBBoltError).message, 'a string');
      return true;
    },
  );
});
