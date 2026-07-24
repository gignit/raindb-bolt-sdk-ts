// agent-bridge/host.ts -- bolt-native AgentHost factory.
//
// Per handoff §I and audit §V.4, @raindb/agent v0.7+ runs inside a
// Lightning Bolt without HTTP self-loops to /graphql. Substrate-
// touching tool calls are intercepted at the host's `fetch` boundary
// and dispatched through @raindb/bolt-sdk's native bindings. LLM
// chatCompletion calls still go through ctx.fetch (those are
// genuinely external).
//
// This module imports types from @raindb/agent (declared as an
// OPTIONAL peer dep in package.json). Bolts that don't use the
// bridge don't need @raindb/agent installed; they simply don't
// import this submodule.
//
// Design constraint: when a substrate tool's binding is STUBBED
// (substrate-side hasn't shipped it), the bridge falls through to
// ctx.fetch -- the agent's tool then makes the GraphQL self-loop
// it would otherwise have made. This is the graceful-degradation
// path. The bridge logs a `bolt.agent-bridge.fallthrough` warning
// per call so operators can see how often it triggers.

// We import @raindb/agent's types lazily via dynamic interface
// declarations so the package compiles even without @raindb/agent
// in node_modules (the optional peer dep model). At runtime, callers
// that import this module will get a clear "module not found" if
// @raindb/agent isn't installed -- which is the right error.
//
// The two @raindb/agent types we depend on (AgentHost,
// ChatCompletionRequest/Response) are documented in
// ~/src/raindb-agent-ts/src/host/types.ts. We declare local
// type interfaces matching that contract; if the contract drifts,
// the structural assignment in makeBoltNativeHost's return value
// stops compiling.

import type { BoltContext } from '../types/bolt-context.js';
import { db } from '../bindings/db.js';
import { sql } from '../bindings/sql.js';
import { setCtx } from '../runtime/ctx-resolver.js';

// ---------------------------------------------------------------------
// Locally-declared shape mirrors of @raindb/agent's types. Kept
// minimal -- we only need enough surface to construct a host.
// ---------------------------------------------------------------------

interface HostFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface HostResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string | string[]>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

interface ChatCompletionMessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'text' | 'json_object' };
  [extra: string]: unknown;
}

interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: unknown[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Locally-declared shape of @raindb/agent's `AgentHost`. Mirror of
 * `~/src/raindb-agent-ts/src/host/types.ts::AgentHost`. Structural
 * compatibility means `makeBoltNativeHost(ctx)`'s return value can
 * be passed to `runAgent({ host: ... })` without a cast.
 */
export interface AgentHost {
  fetch(url: string, init?: HostFetchInit): Promise<HostResponse>;
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  log: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
}

/**
 * Construct an AgentHost backed by @raindb/bolt-sdk's native bindings.
 *
 * Substrate-touching tool calls (droplet_*, token_*, stats_*, relay_*,
 * catalog_*, etc.) are intercepted at `host.fetch` and dispatched
 * through the package's native binding wrappers. Non-substrate URLs
 * and substrate URLs whose binding is stubbed fall through to
 * `ctx.fetch` -- the agent's tool gets the HTTP self-loop it would
 * otherwise have made.
 *
 * LLM chatCompletion calls always go through `ctx.fetch` because those
 * are genuinely external HTTP. The chatCompletion implementation is
 * shape-compatible with @raindb/agent's Node host so the agent loop
 * sees the same wire envelope.
 *
 * @example
 * ```ts
 * import { setCtx, BoltContext } from '@raindb/bolt-sdk';
 * import { makeBoltNativeHost } from '@raindb/bolt-sdk/agent-bridge';
 * import { runAgent, tenantTools } from '@raindb/agent';
 *
 * export async function onHttpRequest(ctx: BoltContext, req) {
 *   setCtx(ctx);
 *   const result = await runAgent({
 *     host: makeBoltNativeHost(ctx),
 *     tools: tenantTools,
 *     messages: req.json.messages,
 *   });
 *   return { status: 200, body: result };
 * }
 * ```
 */
export function makeBoltNativeHost(ctx: BoltContext): AgentHost {
  // Make sure subsequent native-binding calls resolve through this
  // ctx. Bolts typically call setCtx(ctx) directly at handler entry;
  // this is a belt-and-suspenders for callers who construct a host
  // without the explicit setCtx.
  setCtx(ctx);

  return {
    async fetch(url, init) {
      // 1. Non-GraphQL URLs fall through immediately.
      if (!isGraphQLEndpoint(url)) {
        return passthrough(ctx, url, init);
      }

      // 2. GraphQL URLs -- inspect the body to see if it's a
      //    substrate operation we have a native binding for.
      let body: { query?: string; variables?: Record<string, unknown> } | null =
        null;
      try {
        body =
          init?.body !== undefined
            ? (JSON.parse(init.body) as {
                query?: string;
                variables?: Record<string, unknown>;
              })
            : null;
      } catch {
        body = null;
      }

      if (body?.query !== undefined) {
        const opName = extractOperationName(body.query);
        if (opName !== null) {
          const native = await tryRouteToNative(
            opName,
            body.variables ?? {},
          );
          if (native !== undefined) {
            return makeHostResponse(opName, native);
          }
        }
      }

      // 3. Substrate-shaped GraphQL we don't (yet) have a binding
      //    for, OR a non-substrate GraphQL operation. Fall through.
      ctx.log.warn('bolt.agent-bridge.fallthrough', {
        url,
        reason: 'no-native-binding',
      });
      return passthrough(ctx, url, init);
    },

    async chatCompletion(req) {
      // LLM provider calls always go through ctx.fetch -- those are
      // genuinely external HTTP, not a substrate self-loop. The bolt
      // host's chatCompletion shape mirrors @raindb/agent's Node host.
      return chatCompletionViaCtxFetch(ctx, req);
    },

    log: {
      info: (msg, fields) => ctx.log.info(msg, fields),
      warn: (msg, fields) => ctx.log.warn(msg, fields),
      error: (msg, fields) => ctx.log.error(msg, fields),
    },
  };
}

// =====================================================================
// Internals
// =====================================================================

/** Heuristic: any URL whose path ends in `/graphql` (with optional trailing slash). */
function isGraphQLEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/graphql\/?$/i.test(u.pathname);
  } catch {
    // Relative URL or malformed; fall back to substring check.
    return /\/graphql(\/|$|\?)/i.test(url);
  }
}

/**
 * Pull the operation name from a GraphQL query string. Returns the
 * lowercase first-letter-lowercased name (matching how resolvers
 * project), or null if the query doesn't have a recognizable op.
 *
 * This is intentionally simple: a regex match against `query
 * <Name>(...)` or `mutation <Name>(...)`. GraphQL syntax is richer
 * than this but the package only routes against operations whose
 * names match the known substrate verbs anyway.
 */
function extractOperationName(query: string): string | null {
  const m = /(?:query|mutation)\s+(\w+)/.exec(query);
  if (m && m[1] !== undefined) {
    // GraphQL operation names are PascalCase by convention; the
    // resolver's projected field is lowerCamelCase. Convert.
    const name = m[1];
    return name.charAt(0).toLowerCase() + name.slice(1);
  }
  return null;
}

/**
 * Attempt to route a GraphQL operation to a native binding. Returns
 * the projected GraphQL data envelope on success, or undefined when
 * we don't have a native handler for this operation (so the caller
 * falls through to ctx.fetch).
 *
 * Routes every substrate operation the @raindb/agent tool catalog
 * emits AND for which @raindb/bolt-sdk has a LIVE native binding, so
 * the agent takes the fast in-process path (~1000x less Go resource,
 * ~400x faster) instead of an HTTP self-loop back through /graphql:
 *   - readLatest / readDroplet / writeDroplet / listDroplets
 *   - listKeys / executeSQL / tagEntity / untagEntity / expireDroplet
 *
 * Operations whose bindings are still STUB (catalog*, pushPublic,
 * vectorSearch, readCurrent, readRelay, describeFormation, ...) are
 * intentionally NOT routed here -- they fall through to ctx.fetch
 * until the native binding ships. Grow this table in lockstep with
 * the STUB->LIVE swaps (keep it to ops the agent actually emits; a
 * case for an op the agent never sends is dead code).
 */
async function tryRouteToNative(
  opName: string,
  vars: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> } | undefined> {
  // The variables shape in raindb-api's GraphQL is `{ input: { ... } }`;
  // the substrate's `ReadLatestInput` etc. fields match the @raindb/agent
  // tool catalog (and hence our wrapper input shapes).
  const input = (vars['input'] as Record<string, unknown> | undefined) ?? {};

  switch (opName) {
    case 'readLatest': {
      const formationId = String(input['formationId'] ?? '');
      const indexId = String(input['indexId'] ?? '');
      const scopeValue = String(input['scopeValue'] ?? '');
      if (!formationId || !indexId || !scopeValue) return undefined;
      const out = await db.readLatest({ formationId, indexId, scopeValue });
      return { data: { readLatest: out } };
    }

    case 'readDroplet': {
      const formationId = String(input['formationId'] ?? '');
      const dropletId = String(input['dropletId'] ?? '');
      if (!formationId || !dropletId) return undefined;
      const out = await db.readDroplet({ formationId, dropletId });
      return { data: { readDroplet: out } };
    }

    case 'writeDroplet': {
      const formationId = String(input['formationId'] ?? '');
      const payload =
        (input['payload'] as Record<string, unknown> | undefined) ?? {};
      if (!formationId) return undefined;
      const out = await db.writeDroplet({ formationId, payload });
      return { data: { writeDroplet: out } };
    }

    case 'listDroplets': {
      const formationId = String(input['formationId'] ?? '');
      const prefix = input['prefix'] as string | undefined;
      const pageSize = input['pageSize'] as number | undefined;
      if (!formationId) return undefined;
      const listInput: {
        formationId: string;
        prefix?: string;
        pageSize?: number;
      } = { formationId };
      if (prefix !== undefined) listInput.prefix = prefix;
      if (pageSize !== undefined) listInput.pageSize = pageSize;
      const out = await db.listDroplets(listInput);
      // The @raindb/agent shape projects this as a {droplets[], nextCursor,
      // hasMore} page envelope. The native binding returns just the array.
      // For v0.1, project to the page envelope with hasMore=false; the
      // agent's tool tolerates both shapes.
      return {
        data: {
          listDroplets: {
            droplets: out,
            nextCursor: null,
            hasMore: out.length === (pageSize ?? 50),
          },
        },
      };
    }

    // --- LIVE bindings added to the routing table (previously the agent
    //     self-looped these through GraphQL even though a fast native
    //     binding exists). The op names are the raindb-api GraphQL verbs
    //     lowered by extractOperationName; the projected data envelope
    //     mirrors the resolver's field selection the agent tool reads. ---

    case 'listKeys': {
      const formationId = String(input['formationId'] ?? '');
      const indexId = String(input['indexId'] ?? input['indexName'] ?? '');
      if (!formationId || !indexId) return undefined;
      // The agent's ListKeysInput carries cursor-pagination fields
      // (first/after/orderByDesc/...). Forward the ones the native
      // binding's CursorPaginationOpts accepts; the wrapper defaults
      // the rest.
      const opts: Record<string, unknown> = {};
      for (const k of ['first', 'after', 'orderByDesc', 'prefix']) {
        if (input[k] !== undefined) opts[k] = input[k];
      }
      const page = await db.listKeys({
        formationId,
        indexId,
        opts: opts as never,
      });
      return { data: { listKeys: page } };
    }

    case 'executeSQL': {
      const sqlText = String(input['sql'] ?? input['query'] ?? '');
      if (!sqlText) return undefined;
      const withFreshness = input['withFreshness'] === true;
      const out = await sql.query({ sql: sqlText, withFreshness });
      return { data: { executeSQL: out } };
    }

    case 'tagEntity': {
      const formationId = String(input['formationId'] ?? '');
      const scopeValue = String(input['scopeValue'] ?? '');
      const tags = (input['tags'] as Record<string, string> | undefined) ?? {};
      if (!formationId || !scopeValue) return undefined;
      await db.tag({ formationId, scopeValue, tags });
      // Native binding returns void; the agent tool only reads `success`.
      return { data: { tagEntity: { formationId, scopeValue, success: true } } };
    }

    case 'untagEntity': {
      const formationId = String(input['formationId'] ?? '');
      const scopeValue = String(input['scopeValue'] ?? '');
      const tagKeys = (input['tagKeys'] as string[] | undefined) ?? [];
      if (!formationId || !scopeValue) return undefined;
      await db.untag({ formationId, scopeValue, tagKeys });
      return {
        data: { untagEntity: { formationId, scopeValue, success: true } },
      };
    }

    case 'expireDroplet': {
      const formationId = String(input['formationId'] ?? '');
      const scopeValue = String(input['scopeValue'] ?? '');
      if (!formationId || !scopeValue) return undefined;
      await db.expire({ formationId, scopeValue });
      return {
        data: { expireDroplet: { formationId, scopeValue, success: true } },
      };
    }

    default:
      return undefined;
  }
}

/**
 * Wrap a native binding result in a HostResponse-shaped envelope so
 * the agent's `executeGraphQL` reads it the same way it reads a real
 * GraphQL HTTP response.
 */
function makeHostResponse(
  opName: string,
  payload: { data: Record<string, unknown> },
): HostResponse {
  void opName; // kept for future structured logging
  const bodyText = JSON.stringify(payload);
  return {
    status: 200,
    ok: true,
    headers: { 'content-type': 'application/json' },
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(payload as unknown),
  };
}

/**
 * Forward to `ctx.fetch` and adapt the goja-shaped response to a
 * HostResponse. Used for non-GraphQL URLs and for the graceful-
 * degradation fallthrough path.
 */
async function passthrough(
  ctx: BoltContext,
  url: string,
  init?: HostFetchInit,
): Promise<HostResponse> {
  const resp = await ctx.fetch(url, init);
  // ctx.fetch returns a goja-installed object whose `text()` and
  // `json()` are functions returning the value (not promises). We
  // wrap them in Promise.resolve to match HostResponse's shape.
  const body = (resp as { body?: string }).body ?? '';
  return {
    status: resp.status,
    ok: resp.ok,
    headers: resp.headers as Record<string, string | string[]>,
    text: () => Promise.resolve(body),
    json: () => {
      try {
        return Promise.resolve(JSON.parse(body) as unknown);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

/**
 * Bolt-side chatCompletion: build the OpenAI-spec request body, POST
 * it via ctx.fetch, parse the response. The wire shape matches what
 * @raindb/agent's Node host produces (which mirrors openai-node's
 * output 1:1).
 *
 * The endpoint URL is derived from the bolt's invocation context by
 * convention: the Continuum-style pattern is to look for an
 * `LLM_ENDPOINT` secret or a tenant-provided base URL. v0.1 uses a
 * placeholder that callers override -- if your bolt's tenant doesn't
 * have an LLM provider configured, this method will throw.
 *
 * Future v0.2: accept an explicit `endpoint` + `apiKey` argument so
 * the bolt's provider config is explicit. v0.1's behavior is to read
 * the `LLM_API_BASE` and `LLM_API_KEY` secrets if available and fall
 * back to OpenAI's public endpoint -- documented as transitional.
 */
async function chatCompletionViaCtxFetch(
  ctx: BoltContext,
  req: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  // Resolve config from bolt secrets. The names below are
  // conventional; bolts can override by exporting their own host.
  let baseUrl = 'https://api.openai.com/v1';
  let apiKey = '';
  try {
    apiKey = await ctx.secrets.get('LLM_API_KEY');
  } catch {
    // No key configured; let the upstream call fail with a clear
    // 401 so the agent's loop surfaces it.
  }
  try {
    const overrideBase = await ctx.secrets.get('LLM_API_BASE');
    if (overrideBase) baseUrl = overrideBase;
  } catch {
    // No override; use default.
  }

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

  const resp = await ctx.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    throw new Error(
      `chatCompletion failed: ${resp.status} ${(resp.body ?? '').slice(0, 200)}`,
    );
  }

  // ctx.fetch's body is a string; we parse it. (json() exists on the
  // goja side but the wrapper-layer shape varies; doing it here is
  // robust.)
  const bodyStr = (resp as { body?: string }).body ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyStr);
  } catch (err) {
    throw new Error(
      `chatCompletion: non-JSON response from ${url}: ${(err as Error).message}`,
    );
  }
  return parsed as ChatCompletionResponse;
}
