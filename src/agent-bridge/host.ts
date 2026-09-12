// agent-bridge/host.ts -- bolt-native AgentHost factory.

import type { BoltContext } from '../types/bolt-context.js';
import type { CursorPaginationOpts } from '../types/cursor.js';
import { db } from '../bindings/db.js';
import { sql } from '../bindings/sql.js';
import type { SqlQueryInput, PlanStrategy } from '../bindings/sql.js';
import type { KeyPage } from '../types/droplet.js';
import { RainDBBoltError } from '../errors/classes.js';
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
      const scopeValue = input['scopeValue'] as string | undefined;
      const pageSize = input['pageSize'] as number | undefined;
      const after = input['after'] as string | undefined;
      if (!formationId) return undefined;
      // listDroplets now returns a real {droplets, nextCursor, hasMore} page
      // (substrate H12 fix), so pass the cursor through and forward the page
      // envelope directly -- no more synthesizing hasMore from the array
      // length against the requested page size. scopeValue is the SEMANTIC
      // entity narrowing (ListDropletsInput.scopeValue in the SDL); dropping it
      // here would silently widen a scoped query to the whole formation -- the
      // host resolves scopeValue -> the entity's key prefix, so a raw `prefix`
      // is NOT a substitute (never hash/append paths in JS).
      const opts: CursorPaginationOpts = {};
      if (pageSize !== undefined) opts.first = pageSize;
      if (after !== undefined) opts.after = after;
      if (prefix !== undefined) opts.prefix = prefix;
      if (scopeValue !== undefined) opts.scopeValue = scopeValue;
      const page = await db.listDroplets({ formationId, opts });
      return {
        data: {
          listDroplets: {
            droplets: page.droplets,
            nextCursor: page.nextCursor ?? null,
            hasMore: page.hasMore,
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
      // The native listKeys binding (runtime.ListPageOptions / handleDBListKeys)
      // accepts first/after/last/before/prefix ONLY -- it has no maxKeys
      // accumulation target. The GraphQL ListKeysInput DOES declare maxKeys and
      // the resolver honors it. Rather than silently DROP a supplied maxKeys
      // (reducing the requested semantics, which this interception must not do),
      // fall through to ctx.fetch so the real GraphQL route serves it. Same for
      // pageSize/cursor -- native uses first/after, so a caller using the
      // GraphQL-only paging fields gets the authorized GraphQL route.
      for (const unsupported of ['maxKeys', 'pageSize', 'cursor']) {
        if (input[unsupported] !== undefined) return undefined;
      }
      // Descending paging is last+before (NOT an orderByDesc flag). Match the
      // native binding contract.
      const opts: Record<string, unknown> = {};
      for (const k of ['first', 'after', 'last', 'before', 'prefix']) {
        if (input[k] !== undefined) opts[k] = input[k];
      }
      const page = await db.listKeys({
        formationId,
        indexId,
        opts: opts as never,
      });
      // The native KeyEntry.lastModified is an RFC3339 STRING (goja/pod host
      // boundary); the GraphQL KeyEntry.lastModified is Time! -- a Unix-ms
      // NUMBER (model.MarshalTime). Since we are answering a GRAPHQL operation
      // to the agent, project the string to the GraphQL number shape so a
      // consumer decoding the result sees the wire type it expects. Returning
      // the native page unchanged would hand a string where the contract says a
      // number. A malformed/absent timestamp becomes null (never a silent 0).
      return { data: { listKeys: keyPageToGraphQL(page) } };
    }

    case 'executeSQL': {
      const sqlText = String(input['sql'] ?? input['query'] ?? '');
      if (!sqlText) return undefined;
      // Forward EVERY option the SQLInput wire contract carries, not just the
      // SQL text + withFreshness: formationId (prelude scoping + freshness
      // bookmark), timeoutMs, and planStrategy. Dropping them here silently
      // discarded a caller's explicit planner choice / formation hint.
      // Forward each option when PRESENT (defined + non-null), verbatim -- an
      // omitted option stays the host default; a PRESENT-but-invalid value is
      // forwarded to the host validator (ValidatePlanStrategy) so it is rejected
      // loud (bad_request), never silently converted to omission (PR 5.3). The
      // agent's GraphQL variables are untyped JSON, so we cannot assume the
      // union holds; the host is the authority.
      const sqlInput: SqlQueryInput = { sql: sqlText };
      if (typeof input['formationId'] === 'string') {
        sqlInput.formationId = input['formationId'];
      }
      if (typeof input['timeoutMs'] === 'number') {
        sqlInput.timeoutMs = input['timeoutMs'];
      }
      if (input['planStrategy'] !== undefined && input['planStrategy'] !== null) {
        // Cast through the typed union: the value is caller-supplied JSON, so it
        // may be an invalid string. Forwarding it lets the host reject it rather
        // than the JS silently discarding the explicit choice.
        sqlInput.planStrategy = input['planStrategy'] as PlanStrategy;
      }
      // Freshness: request the `latest` bookmark ONLY when a formationId hint is
      // present, because (a) that matches what the @raindb/agent sql_execute
      // tool actually consumes -- it offers the model the freshness/harvest
      // signal only for a formation-scoped query and returns no freshness guidance
      // for an unscoped ad-hoc query -- and (b) assembling the bookmark costs real
      // reads (the droplet-tier cursor + the formation's meta latest pointer), so
      // requesting it on every unscoped query would add hops the caller never
      // reads. A formationId-scoped query is exactly the case that both wants the
      // bookmark and resolves the formation the native executor needs to build it.
      // The native binding has no `withFreshness` field on the wire contract, so
      // an explicit one can still arrive in the untyped GraphQL variables -- honor
      // it verbatim (forward as given) so a caller can force the bookmark off even
      // with a formationId, or on without one.
      if (typeof input['withFreshness'] === 'boolean') {
        sqlInput.withFreshness = input['withFreshness'];
      } else if (sqlInput.formationId !== undefined) {
        sqlInput.withFreshness = true;
      }
      const out = await sql.query(sqlInput);
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
 * Project a native listKeys page onto the GraphQL KeyPage wire shape for the
 * agent interception boundary. The ONLY transform is KeyEntry.lastModified:
 * the native binding emits an RFC3339 STRING (the intentional goja/pod host
 * boundary -- see the compat lock + the documented public API), but the GraphQL contract
 * is Time! -- a Unix-MILLISECOND NUMBER (model.MarshalTime). Since this
 * intercepts a GraphQL operation and answers as GraphQL, a consumer decoding
 * the result must see the number, not the string. A malformed/empty native
 * timestamp is REJECTED (throws) -- Time! is non-null, so emitting null would be
 * successful-shaped data that violates the contract (PR 5.3); a legitimate
 * epoch-0 parses to the finite number 0. Every other field passes through.
 * NOTE: this does NOT change the native ctx.db.listKeys binding's shape -- that
 * stays a string; only the GraphQL-answering agent path converts.
 */
function keyPageToGraphQL(page: KeyPage): {
  keys: Array<{
    key: string;
    size: number;
    lastModified: number;
    etag?: string;
  }>;
  nextCursor?: string | null;
  hasMore: boolean;
  totalCount: number;
} {
  const keys = page.keys.map((k) => {
    // The GraphQL KeyEntry.lastModified is Time! (NON-NULL, a Unix-ms number).
    // A native timestamp that does not parse to a finite instant cannot be
    // projected onto that wire shape. Per PR 5.3 (deterministic success OR
    // explicit failure), REJECT it -- do NOT fabricate `null`, which would be
    // successful GraphQL-shaped data violating the non-null contract, nor `0`,
    // which would be a wrong instant. A legitimate epoch-0 ('1970-01-01T...')
    // parses to a finite 0 and passes through as the number 0.
    const ms = Date.parse(k.lastModified);
    if (!Number.isFinite(ms)) {
      throw new RainDBBoltError(
        `listKeys: native lastModified ${JSON.stringify(k.lastModified)} for key ` +
          `${JSON.stringify(k.key)} is not a valid timestamp; cannot project onto ` +
          `the non-null GraphQL Time! contract.`,
        { binding: 'ctx.db.listKeys', input: { key: k.key, lastModified: k.lastModified } },
      );
    }
    const entry: {
      key: string;
      size: number;
      lastModified: number;
      etag?: string;
    } = {
      key: k.key,
      size: k.size,
      lastModified: ms,
    };
    if (k.etag !== undefined) entry.etag = k.etag;
    return entry;
  });
  const out: {
    keys: typeof keys;
    nextCursor?: string | null;
    hasMore: boolean;
    totalCount: number;
  } = { keys, hasMore: page.hasMore, totalCount: page.totalCount };
  if (page.nextCursor !== undefined) out.nextCursor = page.nextCursor;
  return out;
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
