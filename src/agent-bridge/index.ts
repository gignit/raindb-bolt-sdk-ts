// agent-bridge/index.ts -- public exports of the agent-bridge sub-module.
//
// Imported as `@raindb/bolt-sdk/agent-bridge`. Bolts that don't run
// LLM agents inside themselves don't import this module and don't
// need @raindb/agent installed.

export { makeBoltNativeHost, type AgentHost } from './host.js';
