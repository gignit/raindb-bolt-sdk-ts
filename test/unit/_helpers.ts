// test/unit/_helpers.ts -- shared test fixtures.

import type { BoltContext } from '../../src/types/bolt-context.js';

/**
 * Build a mock BoltContext with sensible defaults. Tests override
 * specific bindings via the `overrides` argument.
 */
export function mockCtx(overrides?: Partial<BoltContext>): BoltContext {
  const noopLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const noopDb = {
    readLatest: async () => null,
    readDroplet: async () => null,
    writeDroplet: async () => ({ dropletId: 'd-mock' }),
    listDroplets: async () => ({ droplets: [], hasMore: false }),
  };
  const base: BoltContext = {
    bolt: {
      id: 'b-mock',
      name: 'mock',
      revision: 'r-mock',
      tenantId: 't-mock',
    },
    log: noopLog,
    db: noopDb,
    fetch: async () => ({
      status: 200,
      ok: true,
      headers: {},
      body: '',
      text: () => '',
      json: () => null,
    }),
    secrets: { get: async () => 'mock-secret' },
    ids: { uuidv7: () => 'uuid-mock' },
    jwt: {
      sign: async () => 'token-mock',
      verify: async () => ({}),
    },
    crypto: {
      hashPassword: async () => 'hash-mock',
      verifyPassword: async () => true,
      randomBytes: async () => 'rand-mock',
    },
    cookies: {
      parse: () => ({}),
      build: () => '',
    },
    iam: { mintWireToken: async () => 'rgr1.mock' },
  };
  return { ...base, ...overrides };
}
