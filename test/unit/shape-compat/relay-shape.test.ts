// test/unit/shape-compat/relay-shape.test.ts -- structural-compat
// proofs against @raindb/agent's relay shapes.

import { test } from 'node:test';

import type {
  RelayAddress,
  RelayLogEntry,
  RelayResult,
} from '../../../src/index.js';

// Mirrors of @raindb/agent v0.6.0 from
// ~/src/raindb-agent-ts/src/tools/relay.ts.

interface AgentRelayAddress {
  formationId: string;
  entityId: string;
  relayId: string;
  parentId?: string;
  primaryId?: string;
}

interface AgentRelayLogEntry {
  logId: string;
  type: string;
  data: string;
  ts: string;
}

interface AgentRelayResult {
  relayId: string;
  parentId?: string | null;
  primaryId?: string | null;
  formationId: string;
  entityId: string;
  relayType?: string;
  status: string;
  details?: Record<string, unknown> | null;
  logIds?: string[];
  logs?: AgentRelayLogEntry[];
  subRelays?: AgentRelayResult[];
}

test('RelayAddress is structurally compatible', () => {
  const _toBolt = (a: AgentRelayAddress): RelayAddress => a;
  const _toAgent = (b: RelayAddress): AgentRelayAddress => b;
  void _toBolt;
  void _toAgent;
});

test('RelayLogEntry is structurally compatible', () => {
  const _toBolt = (a: AgentRelayLogEntry): RelayLogEntry => a;
  const _toAgent = (b: RelayLogEntry): AgentRelayLogEntry => b;
  void _toBolt;
  void _toAgent;
});

test('RelayResult is structurally compatible', () => {
  const _toBolt = (a: AgentRelayResult): RelayResult => a;
  const _toAgent = (b: RelayResult): AgentRelayResult => b;
  void _toBolt;
  void _toAgent;
});
