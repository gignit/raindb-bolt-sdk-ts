// test/unit/shape-compat/droplet-shape.test.ts -- structural-compat
// proofs against @raindb/agent's `DropletResult`, `DropletPage`,
// `KeyEntry`, `KeyPage` shapes.
//
// These are COMPILE-TIME tests. The test runs as a no-op at runtime
// (the function bodies don't do anything observable); the assertion
// IS that this file compiles. If the shapes drift between the two
// packages, tsc fails and CI breaks.
//
// We declare the agent-ts shapes locally rather than `import`ing
// from `@raindb/agent` because the agent is an OPTIONAL peer dep
// and may not be installed. The shapes are copied verbatim from
// `~/src/raindb-agent-ts/src/tools/droplet.ts`. When the agent's
// shapes change in a way that should be reflected here, this file
// updates and the bolt-sdk's types update with it.

import { test } from 'node:test';

import type {
  Droplet,
  DropletPage,
  KeyEntry,
  KeyPage,
  WriteResult,
  BulkDropletResult,
} from '../../../src/index.js';

// ---------------------------------------------------------------------
// Local mirrors of @raindb/agent v0.6.0 shapes (from
// ~/src/raindb-agent-ts/src/tools/droplet.ts). Update when the agent
// updates.
// ---------------------------------------------------------------------

interface AgentDropletResult {
  dropletId: string;
  formationId: string;
  schemaVersion: number;
  ts: string;
  author: string;
  tenantId?: string;
  batchId?: string;
  payload: Record<string, unknown> | null;
  floatMeta?: Record<string, unknown> | null;
  pointerETag?: string | null;
}

interface AgentDropletPage {
  droplets: AgentDropletResult[];
  nextCursor?: string | null;
  hasMore: boolean;
}

interface AgentKeyEntry {
  key: string;
  size: number;
  lastModified: string;
}

interface AgentKeyPage {
  keys: AgentKeyEntry[];
  nextCursor?: string | null;
  hasMore: boolean;
  totalCount: number;
}

interface AgentWriteResult {
  dropletId: string;
  pathsWritten: string[];
  floatPaths: string[];
  publicUrls: string[];
  vectorRefs: string[];
  warnings: string[];
  scopeValue?: string | null;
  pointerETag?: string | null;
  durationMs: number;
}

interface AgentBulkDropletResult {
  index: number;
  dropletId?: string;
  scopeValue?: string;
  succeeded: boolean;
  error?: string;
}

// ---------------------------------------------------------------------
// Compile-time assertions: each direction of structural assignability.
// These functions are never called; they exist for tsc to type-check.
// ---------------------------------------------------------------------

test('Droplet is structurally compatible with @raindb/agent DropletResult', () => {
  const _agentToBolt = (a: AgentDropletResult): Droplet => a;
  const _boltToAgent = (b: Droplet): AgentDropletResult => b;
  // Use both functions so eslint/tsc don't drop them as unused.
  void _agentToBolt;
  void _boltToAgent;
});

test('DropletPage is structurally compatible with @raindb/agent DropletPage', () => {
  const _toBolt = (a: AgentDropletPage): DropletPage => a;
  const _toAgent = (b: DropletPage): AgentDropletPage => b;
  void _toBolt;
  void _toAgent;
});

test('KeyEntry is structurally compatible with @raindb/agent KeyEntry', () => {
  const _toBolt = (a: AgentKeyEntry): KeyEntry => a;
  const _toAgent = (b: KeyEntry): AgentKeyEntry => b;
  void _toBolt;
  void _toAgent;
});

test('KeyPage is structurally compatible with @raindb/agent KeyPage', () => {
  const _toBolt = (a: AgentKeyPage): KeyPage => a;
  const _toAgent = (b: KeyPage): AgentKeyPage => b;
  void _toBolt;
  void _toAgent;
});

test('WriteResult is structurally compatible with @raindb/agent WriteResult', () => {
  const _toBolt = (a: AgentWriteResult): WriteResult => a;
  const _toAgent = (b: WriteResult): AgentWriteResult => b;
  void _toBolt;
  void _toAgent;
});

test('BulkDropletResult is structurally compatible with @raindb/agent', () => {
  const _toBolt = (a: AgentBulkDropletResult): BulkDropletResult => a;
  const _toAgent = (b: BulkDropletResult): AgentBulkDropletResult => b;
  void _toBolt;
  void _toAgent;
});
