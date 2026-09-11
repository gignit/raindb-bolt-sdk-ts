# @raindb/bolt-sdk

Typed bindings for RainDB Lightning Bolt handler authors.

A TypeScript NPM package giving you a typed, ergonomic API over the
goja sandbox bindings that bolts run inside. The package's runtime
cost is approximately zero -- at runtime, the compiled JS calls
`ctx.*` directly. The value is at dev time: types, completion,
typed error classes, IntelliSense everywhere.

This README is the canonical guide for writing a bolt that uses
every RainDB capability: data IO, LLM-driven chat with SSE streaming,
authentication staircases that can build entire SaaS products on top
of RainDB IAM, secrets, scheduled work, and the agent loop.

---

## Table of contents

1. [What a bolt is](#what-a-bolt-is)
2. [Quick start: 30-line bolt](#quick-start-30-line-bolt)
3. [Anatomy of a bolt directory](#anatomy-of-a-bolt-directory)
4. [The `ctx` object: every binding you have](#the-ctx-object-every-binding-you-have)
5. [LLM integration via `@raindb/agent`](#llm-integration-via-raindbagent)
6. [SSE streaming responses](#sse-streaming-responses)
7. [IAM: from "I just need login" to "I'm building a SaaS"](#iam-from-i-just-need-login-to-im-building-a-saas)
8. [Error handling](#error-handling)
9. [Capabilities, secrets, deployment](#capabilities-secrets-deployment)
10. [Dev loop: local Vite + live deployed bolt](#dev-loop-local-vite--live-deployed-bolt)
11. [Compatibility + versioning](#compatibility--versioning)
12. [Marketplace inventory](#marketplace-inventory)
13. [See also](#see-also)

---

## What a bolt is

A bolt is a TypeScript handler bundle that runs inside RainDB
Lightning's goja sandbox. Each bolt:

- Is **tenant-scoped**: every droplet read/write goes through the
  tenant prefix automatically. No multi-tenancy plumbing in your code.
- Is **sandboxed**: no `process`, no `fs`, no surprise globals. Only
  the `ctx` object the runtime hands you.
- Is **invocation-isolated**: per-request state lives in the
  invocation; cross-request state lives in formations or secrets.
- Is **declaratively configured**: `capabilities.json` says what
  formations / secrets / network you touch. The runtime enforces it.

You write the handler. RainDB provides everything else: database
(S3-backed formations), cache (object cache + wire mesh), pub/sub
(droplet writes -> SSE wakeups), vector DB (chunks + embeddings
formations), LLM agent runtime (`@raindb/agent`), real-time streaming
(SSE), auth (`ctx.iam.mintWireToken`, `ctx.jwt`, `ctx.crypto`),
secrets manager, scheduled jobs, and the periscope datalake cascade.

---

## Quick start: 30-line bolt

```typescript
// bolt/server/src/index.ts
import {
  setCtx,
  db,
  log,
  BoltContext,
  BoltRequest,
  BoltResponse,
  CapabilityDenied,
} from '@raindb/bolt-sdk';

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);

  if (req.method === 'GET' && req.path.startsWith('/api/agent/')) {
    const id = req.path.slice('/api/agent/'.length);
    try {
      const agent = await db.readLatest({
        formationId: 'agent-graph',
        indexId: 'by-id-latest',
        scopeValue: id,
      });
      if (agent === null) return { status: 404, body: { error: 'not found' } };
      log.info('agent read', { id });
      return { status: 200, body: agent };
    } catch (e) {
      if (e instanceof CapabilityDenied) {
        return { status: 403, body: `bolt missing ${e.op} on ${e.formationId}` };
      }
      throw e;
    }
  }

  return { status: 404, body: 'not found' };
}
```

**The `setCtx(ctx)` call is the required first line of every
handler.** It registers the invocation's `ctx` so subsequent calls
into `db.*`, `log.*`, `auth.*` resolve through it. Skip it and the
SDK throws `RainDBBoltError("setCtx not called")` on the first
wrapper call.

Deploy:

```bash
cd bolt
raindb-cli --profile <yours> lightning bolt deploy --name my-bolt \
  --source . --routes ./routes.json \
  --capabilities ./capabilities.json --deployment ./deployment.json \
  --domain my-bolt.<env>.raindb.gignit.com
```

(Pass `--routes ./routes.json` explicitly the first time. The CLI
cache picks it up and the short form `lightning bolt deploy <name>`
works on subsequent deploys.)

---

## Anatomy of a bolt directory

```
<project-root>/        # this directory IS the bolt (the deploy --source)
  server/
    index.ts           # exports onHttpRequest, onSchedule, onWakeUp, ...
  client/              # optional -- omit for a server-only / headless bolt
    dist/              # static SPA assets the bolt serves
  config/              # capabilities.json, routes.json, deployment.json
  formations/          # bolt-bundled formation configs + schemas (optional)
  dist/main.js         # built server bundle (esbuild --format=cjs)
```

### Standard layout (follow this; everything else is an escape hatch)

A bolt is just a **directory with a server entry**. The standard, recommended
layout an agent should scaffold and assume:

- **`server/index.ts`** -- the handler (`onHttpRequest`, ...). This is the one
  required thing; it makes the directory a bolt.
- **`client/`** -- the frontend, built to `client/dist`. **Optional**: omit it
  entirely for a server-only / API / webhook / scheduled bolt.
- **`config/`** -- `capabilities.json`, `routes.json`, `deployment.json`. These
  are passed to `deploy` via `--capabilities`/`--routes`/`--deployment` and may
  live anywhere; `config/` is the convention. (Routes are optional under
  `--auto-routes`.)
- **`formations/`** -- the data model. Optional.

**Where you run from:** the **project root is the bolt** (`deploy --source .`),
and `raindb-cli` auto-discovers it -- run `lightning bolt deploy` from the root
or any subdirectory and it finds the bolt by walking up to the git project
root. No `--source` needed for the standard layout.

**Escape hatches** (only for nonstandard layouts): `--source <dir>` to point at
a bolt somewhere else, `--entry <path>` for a server entry not at
`server/index.ts` (auto-detect order: `server/index.{ts,js}`,
`src/index.{ts,js}`, `index.{ts,js}`), `--client-dist <path>` for a client not
at `client/dist`. An agent following the standard layout never needs these.

The full legacy form (config files at the bolt root instead of `config/`) also
works -- the deploy flags take any path -- but the layout above is the one to
scaffold.

### `routes.json`

```json
{
  "sse": [
    { "path": "/api/v1/wire/subscribe" }
  ],
  "routes": [
    { "method": "POST", "path": "/api/chat/sessions/:sid/messages", "handler": "onHttpRequest", "streaming": true },
    { "method": "GET",  "path": "/api/*", "handler": "onHttpRequest" },
    { "method": "POST", "path": "/api/*", "handler": "onHttpRequest" }
  ],
  "static": [
    { "path": "/assets/*", "publicAsset": "assets/" },
    { "path": "/*",        "publicAsset": "index.html" }
  ]
}
```

Route resolution is FIRST MATCH. Declare SSE routes first, streaming
routes next (with `streaming: true`), then the buffered API catch-all,
then static.

**The `streaming: true` flag is critical.** It tells lightning to
take the streaming dispatch path -- which sets `text/event-stream`
headers, disables proxy buffering, and wires `ctx.response.write`
into your handler so you can pump SSE frames in real time. Without
the flag, the handler returns a buffered `BoltResponse` and clients
see all the events at once when the handler completes.

Common mistake: declaring streaming routes correctly in `routes.json`
but deploying the bolt via the short-form `bolt deploy <name>` when
the CLI cache has `autoRoutes: true` (set by a prior
`--auto-routes` deploy). The cache wins; auto-routes drops every
per-route flag including `streaming: true`. Always pass `--routes
./routes.json` explicitly the first time you deploy a bolt with
streaming routes -- the cache then preserves the path for short-form
deploys.

### `capabilities.json`

```json
{
  "raindb": {
    "formations": [
      { "id": "agent-graph", "ops": ["read", "write"] },
      { "id": "session",     "ops": ["read", "write"] }
    ],
    "secrets":   { "names": ["openai_api_key", "session-secret"] },
    "actions":   ["enqueue"],
    "wire":      { "subscribe": [{ "formationId": "agent-graph", "ops": ["read"] }] }
  },
  "network": {
    "fetch": { "allowedHosts": ["api.openai.com"] }
  },
  "limits": {
    "cpuMs":    5000,
    "memoryMb": 128,
    "wallMs":   30000
  }
}
```

If your handler calls a binding for a formation/secret/host you didn't
declare, the runtime throws `CapabilityDenied` (caught with
`instanceof`).

### `deployment.json`

```json
{
  "engine":     "goja",
  "entrypoint": "dist/main.js",
  "mount":      "/",
  "healthcheck": "/api/health"
}
```

---

## The `ctx` object: every binding you have

The bolt context is the entire environment your handler sees. Every
binding below is either LIVE (substrate ships it today) or STUB
(wrapper compiles + ships, substrate-side pending; throws
`BindingNotInstalled` at runtime until landed).

### LIVE bindings

| Namespace      | Methods                                                                                      |
|----------------|----------------------------------------------------------------------------------------------|
| `log`          | `info`, `warn`, `error`                                                                      |
| `db`           | `readLatest`, `readDroplet`, `writeDroplet`, `listDroplets`, `listKeys`, `listSince`, `writeBatch`, `tag`, `untag`, `expire`, `expirationDays`, `mutate`, `mutateAndRead`, `writeToken` |
| `objects`      | `get`, `put`, `exists`, `delete` -- PRIVATE-tier + tenant-prefix-locked (gated by `capabilities.raindb.objects`) |
| `sql`          | `query` -- native local DuckDB executor; returns column-keyed rows (identical shape to the `executeSQL` GraphQL surface) |
| `schedule`     | `Schedule(formationId, actionRef, runAfterMs, payload)` -- enqueue a deferred bolt callback |
| `fetch`        | `(method, url, headers, body) -> {status, headers, body}` -- HTTPS-only, capability-gated  |
| `secrets`      | `get(name)`                                                                                  |
| `ids`          | `uuidv7()`                                                                                   |
| `jwt`          | `sign(secretName, claims, expiresInSec)`, `verify(secretName, token)`                        |
| `crypto`       | `hashPassword(pw, cost?)`, `verifyPassword(pw, hash)`, `randomBytes(n?)`                     |
| `cookies`      | `parse(headerValue)`, `build(name, value, opts)`                                             |
| `iam`          | `mintWireToken({ subject, resources, ttlSec })` -- mint per-user wire-key tokens for SSE   |
| `auth`         | `tenantId`, `subject`, `apiClientId`, `isAnonymous`, `permits(...)`, `permitsWireKeySubscribe(...)` -- per-request grant inspection |
| `response`     | `setHeader`, `beginStream`, `write` -- streaming routes only                                |

**`db.mutate` / `db.mutateAndRead`** are atomic read-modify-write on a
cache-backed token (formation must declare `lifecycle.autoCache: true`).
`mutateAndRead` returns the post-mutation counter values in one op --
the subtract-a-counter-and-read-remaining primitive. Pair a
`windowIncrement` op for a monthly quota that passively resets with no
cron. Capability op: `mutate`. **`db.writeToken`** writes a token
droplet (capability op: `token-write`).

### STUB bindings (wrapper ships, substrate-side pending)

| Namespace      | Methods                                                                                          |
|----------------|--------------------------------------------------------------------------------------------------|
| `db` (cont'd)  | `readAt`, `readCurrent`, `resolveFormation`                                                      |
| `token`        | `write`, `claim`, `read`, `delete`, `deleteAll`                                                  |
| `stats`        | `increment`, `set`, `batch`, `drain`                                                             |
| `relay`        | `write`, `read`, `updateStatus`, `spawnChild`, `writeLog`, `enqueueToken`, `dequeueToken`        |
| `actions`      | `dispatch`, `invoke`                                                                             |
| `vectors`      | `query`, `queryByText`, `deleteFormation`                                                        |
| `files`        | `pushPublic`, `readMeta` -- STUB (throw a clear not-implemented error). `reserveUpload` + `reserveDownload` are NOT stubs; see below. |
| `catalog`      | `insert`, `list`, `tree`                                                                         |
| `formations`   | `describe`, `list`, `warm`                                                                       |
| `flows`        | `queryState`                                                                                     |
| `tags`         | `replaceTags` -- no native atomic replace; emulate via `db.untag` + `db.tag`                    |

A STUB binding throws `BindingNotInstalled` when the runtime does not provide
it. A TypeScript declaration alone does not establish runtime availability.
Consult the supported bindings and required capabilities before using an operation.

Not every wrapper is native-or-STUB. Some are **GraphQL-backed** (they
call a real GraphQL op through `ctx.fetch`, not a native binding, so
they do NOT throw `BindingNotInstalled`):

- **`files.reserveUpload`** -- LIVE via the `reserveDirectUpload` GraphQL
  op; returns a presigned upload URL + expiry.
- **`files.reserveDownload`** -- LIVE via the `readFloat` GraphQL op.
  Returns the bytes FULLY BUFFERED (base64 + a self-contained `data:`
  URL). It is NOT a presigned GET and NOT an expiring artifact -- there
  is no server-side TTL; use it for small results.

`files.pushPublic` and `files.readMeta` are the only `files` STUBs (they
throw a clear not-implemented error pointing at the alternative).

### Examples

**Database read (tenant-scoped automatically):**

```typescript
import { db } from '@raindb/bolt-sdk';

const session = await db.readLatest({
  formationId: 'session',
  indexId:     'by-id-latest',
  scopeValue:  sessionId,
});
// returns the envelope { schemaVersion, tenantId, dropletId, payload, ... }
// or null if no current droplet exists
```

**Write a droplet (writes go through SDK envelope generation):**

```typescript
const dropletId = await db.writeDroplet({
  formationId: 'session',
  payload: {
    sessionId,
    userId,
    createdAt: new Date().toISOString(),
  },
});
```

**Outbound HTTP (with allowed-host gate):**

```typescript
import { fetch as boltFetch } from '@raindb/bolt-sdk';

const { status, body } = await boltFetch({
  method:  'POST',
  url:     'https://api.openai.com/v1/embeddings',
  headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body:    JSON.stringify({ model: 'text-embedding-3-small', input: text }),
});
```

The bolt's `capabilities.network.fetch.allowedHosts` gate fires
BEFORE the DNS lookup -- requests to undeclared hosts throw
`CapabilityDenied` instantly.

**Schedule a deferred callback:**

```typescript
import { schedule } from '@raindb/bolt-sdk';

await schedule.Schedule({
  formationId: 'session-cleanup',
  actionRef:   'expireStaleSessions',
  runAfterMs:  3600 * 1000,
  payload:     { sweepId: ctx.ids.uuidv7() },
});
```

The runtime invokes `onSchedule(ctx, { formationId, actionRef,
payload })` on your bolt at the scheduled time.

---

## LLM integration via `@raindb/agent`

`@raindb/bolt-sdk` ships an optional sub-module
`@raindb/bolt-sdk/agent-bridge` that builds an `AgentHost` for
`@raindb/agent`'s `runAgent` loop. Substrate-touching tool calls
(droplet_*, vector_search, etc.) are intercepted at the host's
`fetch` boundary and dispatched through native bindings -- no HTTP
self-loops back through the gateway. LLM provider calls
(`chatCompletion`) go through `ctx.fetch` because those are
genuinely external HTTP.

### Minimal LLM chat handler

```typescript
import { setCtx, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';
import { makeBoltNativeHost } from '@raindb/bolt-sdk/agent-bridge';
import { runAgent, tenantTools } from '@raindb/agent';

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);

  if (req.method !== 'POST' || req.path !== '/api/chat') {
    return { status: 404, body: 'not found' };
  }

  const body = req.json as { message: string; history?: unknown[] };

  const result = await runAgent({
    systemPrompt: 'You are a helpful assistant for this project.',
    userPrompt:   body.message,
    history:      (body.history ?? []) as never,
    ctx: {
      creds: {
        apiKey:   await ctx.secrets.get('platform-api-key'),
        endpoint: await ctx.secrets.get('platform-api-endpoint'),
      },
      host:   makeBoltNativeHost(ctx),
      role:   'read',
      userId: ctx.auth?.subject ?? 'anonymous',
    },
    tools:        tenantTools,
    maxIterations: 8,
  });

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content:    result.content,
      iterations: result.iterations,
      durationMs: result.durationMs,
    }),
  };
}
```

The agent loop resolves the chat model automatically via raindb's
`llmRegistry` (cached 5min per API key). Override with `model: 'gpt-5'`
to pin a specific model.

`@raindb/agent` is declared as an OPTIONAL peer dependency. Bolts
that don't run LLM agents don't need it installed.

See [`@raindb/agent`'s README](../raindb-agent-ts/README.md) for the
full tool catalog, custom-tool authoring, and chatCompletion shape.

### Streaming LLM chat with SSE (recommended)

Pair the agent loop with `streaming: true` + `ctx.response.write` so
the browser sees per-event progress instead of a single end-of-handler
chunk. See [SSE streaming responses](#sse-streaming-responses) below
for the full pattern.

---

## SSE streaming responses

Lightning's streaming dispatch path turns your handler into a
real-time event source. Two pieces:

1. **Route declares `streaming: true`** in `routes.json`. The
   dispatcher takes the streaming code path: sets
   `content-type: text/event-stream`, `cache-control: no-cache`,
   `connection: keep-alive`, `x-accel-buffering: no` BEFORE invoking
   your handler. Spawns a fasthttp StreamWriter goroutine that pumps
   each `ctx.response.write` call to the wire AND flushes
   immediately.

2. **Handler calls `ctx.response.write`** (or the SDK's typed
   `response.write` wrapper) for each frame. Each call hits the wire
   as a separate network packet. The handler returns an empty body
   when done -- the runtime asserts streamed-AND-empty-body.

### Minimal streaming handler

```typescript
import { setCtx, response, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);

  if (req.method !== 'POST' || req.path !== '/api/stream') {
    return { status: 404, body: 'not found' };
  }

  await response.setHeader('content-type', 'text/event-stream');
  await response.setHeader('cache-control', 'no-cache, no-transform');
  await response.beginStream(200);

  for (let i = 1; i <= 5; i += 1) {
    await response.write(frame('tick', { i, at: Date.now() }));
    // Simulate work; in real handlers you await DB / fetch / etc.
  }
  await response.write(frame('done', { ok: true }));

  return { status: 200, headers: {}, body: '' };
}
```

### Streaming LLM agent dispatch (the canonical pattern)

```typescript
import { setCtx, response, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';
import { makeBoltNativeHost } from '@raindb/bolt-sdk/agent-bridge';
import { runAgent, tenantTools, type AgentEvent } from '@raindb/agent';

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);

  if (req.method !== 'POST' || req.path !== '/api/chat') {
    return { status: 404, body: 'not found' };
  }

  const body = req.json as { message: string };

  // Streaming-route gate: ctx.response is only wired when
  // routes.json declared `streaming: true`. Bolts that ship the
  // same handler for streaming + non-streaming routes branch here.
  const streaming = ctx.response !== undefined;
  if (streaming) {
    await response.setHeader('content-type', 'text/event-stream');
    await response.setHeader('cache-control', 'no-cache, no-transform');
    await response.setHeader('connection', 'keep-alive');
    await response.beginStream(200);
  }

  const frames: string[] = [];
  const send = (e: AgentEvent | { type: string; data?: unknown }) => {
    const wire = sseFrame(e.type, e);
    if (streaming) {
      void response.write(wire);
    } else {
      frames.push(wire);
    }
  };

  try {
    const result = await runAgent({
      systemPrompt: 'You are a helpful assistant.',
      userPrompt:   body.message,
      ctx: {
        creds: {
          apiKey:   await ctx.secrets.get('platform-api-key'),
          endpoint: await ctx.secrets.get('platform-api-endpoint'),
        },
        host:   makeBoltNativeHost(ctx),
        role:   'read',
        userId: ctx.auth?.subject ?? 'anonymous',
      },
      tools:   tenantTools,
      onEvent: send,
    });
    send({ type: 'done', data: { iterations: result.iterations } });
  } catch (err) {
    send({ type: 'error', data: { error: err instanceof Error ? err.message : String(err) } });
  }

  if (streaming) {
    return { status: 200, headers: {}, body: '' };
  }
  return {
    status: 200,
    headers: {
      'content-type':  'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection':    'keep-alive',
    },
    body: frames.join(''),
  };
}
```

The agent loop emits one `AgentEvent` per phase
(`thinking`, `tool-call`, `tool-result`, `tool-error`, `final`).
The handler forwards each to the wire as one SSE frame. The browser
sees progressive thinking, tool announcements, and the final reply
arrive in real time.

### Client-side: consume the stream

```typescript
const res = await fetch('/api/chat', {
  method:  'POST',
  headers: { 'content-type': 'application/json' },
  body:    JSON.stringify({ message: 'hello' }),
});
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = '';

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let end: number;
  while ((end = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, end);
    buf = buf.slice(end + 2);
    const eventMatch = frame.match(/^event:\s*(\S+)/);
    const dataMatch  = frame.match(/^data:\s*(.+)$/m);
    if (eventMatch && dataMatch) {
      const payload = JSON.parse(dataMatch[1]!);
      handleEvent(eventMatch[1]!, payload);
    }
  }
}
```

`EventSource` works too -- but it only supports GET, and many SSE
chat endpoints are POST (the request carries the prompt). The
`fetch` + `getReader` pattern above is suitable for
`fdn-app` ship.

### Verifying SSE wired correctly

Probe with chrome-devtools or a tiny script:

```typescript
const startMs = performance.now();
const res = await fetch('/api/chat', { method: 'POST', ... });
const headers = Object.fromEntries(res.headers.entries());
// Look for these:
//   content-type:       'text/event-stream'  (NOT 'text/plain; charset=utf-8, text/event-stream')
//   x-accel-buffering:  'no'
//   content-length:     should be ABSENT
// If you see content-length OR a duplicate content-type prefix, the
// route is NOT going through the streaming dispatch path. Check
// (a) routes.json has streaming:true on the route, (b) the deployed
// bolt confirms it via `raindb-cli lightning bolt info <name> -o json`,
// (c) the CLI cache doesn't have stale autoRoutes:true.
```

### Common SSE pitfalls

- **`streaming: true` missing from `routes.json`**: handler runs
  through the buffered path; browser sees one chunk at the end.
- **CLI cache has `autoRoutes: true`**: cache wins over `routes.json`;
  per-route flags are dropped. Pass `--routes ./routes.json` once to
  fix.
- **Handler returns a body and calls `response.write`**: lightning
  asserts streamed-AND-empty-body and throws. Pick one shape per
  handler.
- **Handler writes events too close together**: goja's async-Promise
  machinery may batch writes within a single event-loop tick. Inject
  a `Promise.resolve().then()` between events that fire less than ~5ms
  apart if you need crisp progressive arrival.
- **Handler does work AFTER the last `response.write` and before
  returning**: that work delays the connection close, but the bytes
  are already on the wire -- a no-op for the browser, but it
  occupies a server handler slot. Keep the post-stream work minimal.

---

## IAM: from "I just need login" to "I'm building a SaaS"

RainDB IAM is layered so bolts can adopt as much or as little as they
need. The full stack:

| Layer | Mechanism | Use when |
|---|---|---|
| 1. JWT cookies | `ctx.jwt.sign` + `ctx.crypto.hashPassword` | You just need username/password login for your bolt's users |
| 2. `ctx.auth` per-request grant | `ctx.auth.tenantId`, `.subject`, `.permits(...)` | You want the substrate to enforce per-user authorization on EVERY droplet call |
| 3. Wire-token mint for SSE | `ctx.iam.mintWireToken({ subject, resources, ttlSec })` | You want the browser to subscribe directly to S3 key changes for real-time push |
| 4. Cross-tenant grant chains | `ctx.iam.mintScopedGrant` (via raindb-api) | You're building a portal that brokers between MULTIPLE downstream tenants (e.g. fdn-app, raindb-app) |

### Layer 1: bolt-owned username + password login

For a bolt that wants its OWN identity model (basic SaaS),
write user records into a formation and validate
username/password yourself. The bolt is the source of truth for
auth.

```typescript
// POST /api/auth/register
const { username, password } = req.json;
const passwordHash = await crypto.hashPassword(password);
const userId = ctx.ids.uuidv7();
await db.writeDroplet({
  formationId: 'app-users',
  payload: { userId, username, passwordHash, createdAt: new Date().toISOString() },
});
return { status: 201, body: { userId } };

// POST /api/auth/login
const user = await db.readLatest({
  formationId: 'app-users',
  indexId:     'by-username-latest',
  scopeValue:  username,
});
if (!user?.payload) return { status: 401, body: 'invalid' };
const ok = await crypto.verifyPassword(password, user.payload.passwordHash);
if (!ok) return { status: 401, body: 'invalid' };

// Mint your own session JWT
const token = await jwt.sign('session-secret', {
  sub:  user.payload.userId,
  iat:  Math.floor(Date.now() / 1000),
}, 86400);

const setCookie = await cookies.build('session', token, {
  path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 86400,
});
return { status: 200, headers: { 'Set-Cookie': setCookie }, body: { ok: true } };

// On subsequent requests:
const jar = await cookies.parse(req.headers['cookie'] ?? '');
const claims = await jwt.verify('session-secret', jar['session'] ?? '');
const userId = claims.sub;  // <-- use this as the authorization anchor
```

This is the entire SaaS-on-RainDB auth pattern: bolt owns the user
table, bolt mints the cookie, bolt validates the cookie on every
request. **Crucially: the userId from the validated JWT MUST be the
control on every subsequent DB read/write** -- this is how you stop
user A from reading user B's data. Pattern:

```typescript
// Filter every write by the authenticated userId
const messageId = ctx.ids.uuidv7();
await db.writeDroplet({
  formationId: 'app-messages',
  payload: {
    messageId,
    userId,                 // <-- authenticated from the cookie, NOT from req.body
    content: req.json.content,
    createdAt: new Date().toISOString(),
  },
});

// Filter every read by the authenticated userId via the index
const myMessages = await db.listKeys({
  formationId: 'app-messages',
  indexId:     'by-userId-latest',
  prefix:      userId,
  first:       50,
});
```

**Anti-pattern**: trusting `userId` from the request body. Every
sensitive write MUST anchor on the userId you extracted from the
verified cookie/JWT/header. RainDB formations don't enforce row-level
authorization out of the box -- that's the bolt's job.

### Layer 2: substrate-validated grants via `ctx.auth`

If you'd rather let the SUBSTRATE enforce authorization (so bad
bolt code can't accidentally leak data), pair the bolt with
RainDB's mint-flow. The browser presents an `rgr1.<...>` grant
on every request. Lightning's dispatcher validates it before your
handler runs and surfaces the result on `ctx.auth`:

```typescript
import { auth, db } from '@raindb/bolt-sdk';

export async function onHttpRequest(ctx, req) {
  setCtx(ctx);

  if (ctx.auth?.isAnonymous) {
    return { status: 401, body: 'unauthenticated' };
  }

  // ctx.auth.tenantId is the USER's tenant (where their data lives).
  // For a portal bolt serving a user from another tenant,
  // ctx.auth.tenantId === chess. The bolt's host tenant lives on
  // ctx.bolt.tenantId.
  const userTenantId = ctx.auth!.tenantId;
  const userId       = ctx.auth!.subject;

  // Optionally pre-check before doing work
  if (!ctx.auth!.permits('formation', 'private-notes', 'read')) {
    return { status: 403, body: 'forbidden' };
  }

  const notes = await db.listDroplets({
    formationId: 'private-notes',
    prefix:      userId,
    pageSize:    50,
  });
  return { status: 200, body: notes };
}
```

The substrate-side `scopedObjectStore` decorator validates every S3
key your handler tries to read or write against the grant's resource
list. A bolt that tries to read `tenants/other-user/...` with a grant
scoped to its own tenant gets a hard `403` from the runtime --
regardless of whether the bolt JS code thought it was authorized.

### Layer 3: wire-token mint for browser-direct SSE

To let the browser subscribe to S3 key changes directly (real-time
push without polling), mint a short-lived wire-token in the handler
and hand it to the browser:

```typescript
import { iam } from '@raindb/bolt-sdk';

const wireToken = await iam.mintWireToken({
  subject: ctx.auth!.subject,
  resources: [
    {
      type: 'wire-key',
      id:   `tenants/${ctx.auth!.tenantId}/entities/app-messages/by-userId-latest/${userId}/latest.json`,
      ops:  ['subscribe'],
    },
  ],
  ttlSec: 3600,
});

return { status: 200, body: { wireToken } };
```

The browser opens an `EventSource` to
`https://<your-api-endpoint>/sse?token=<rgr1.*>` and the
SSE gateway pushes a wakeup every time the matching chain-head
S3 object changes. The mint is gated by the same 3-rule check
(`wire-key:subscribe` OR `formation:read` OR `tenant:admin`) your
bolt's grant satisfies -- so users can ONLY mint subscriptions for
keys their grant authorizes.

### Layer 4: cross-tenant SaaS portal patterns

A portal may serve users from more than one tenant. Its deployment tenant and
the authenticated user's tenant are separate identities. Use `ctx.auth` for the
current user's identity and permissions; do not authorize a user from the bolt's
deployment identity. Access to another tenant requires an explicitly authorized
grant. A bolt does not gain administrator access merely by acting as a portal.

### Recap: pick the right layer

| You want... | Use... |
|---|---|
| Username/password login for your app's users | `crypto` + `jwt` + `cookies` (Layer 1) |
| Substrate-enforced authorization on every droplet call | `ctx.auth.tenantId` + `ctx.auth.permits` + delegate to lightning's gate (Layer 2) |
| Real-time browser push from S3 changes | `iam.mintWireToken` (Layer 3) |
| Multi-tenant SaaS portal that brokers user access to many tenants | `mintScopedGrant` via raindb-api (Layer 4) |

Layers compose. A SaaS bolt commonly uses ALL FOUR:
Layer 1 for the bolt-owned user table, Layer 2 for substrate-validated
per-user grants on each request, Layer 3 for SSE wire-tokens, Layer 4
to broker access to the picked tenant.

---

## Error handling

Every binding wrapper translates substrate-side errors to typed
classes. Catch with `instanceof`:

```typescript
import {
  RainDBBoltError,         // base; catch-all for anything from the SDK
  CapabilityDenied,        // bolt's capabilities.json missing an op
  BindingNotInstalled,     // STUB binding called against a substrate that hasn't shipped it
  TokenExists,             // claim against an existing scope
  TokenExpired,            // token recycled by lifecycle
  ConditionFailed,         // CAS write rejected (expectedETag, ifFieldEquals)
  StatsValidation,         // stats binding rejected (unknown field, op-mismatch, ...)
  AuthorRequired,          // wrapper couldn't derive a required author field
} from '@raindb/bolt-sdk';

try {
  await token.claim('continuum-stats', 'global', { author: 'bot' });
} catch (e) {
  if (e instanceof TokenExists) {
    // already initialized; safe to ignore in init paths
  } else if (e instanceof BindingNotInstalled) {
    log.warn('token binding pending', { e: String(e) });
  } else if (e instanceof RainDBBoltError) {
    log.error('sdk error', { binding: e.binding, msg: e.message });
    throw e;
  } else {
    throw e;
  }
}
```

`RainDBBoltError.binding` carries the canonical binding name
(e.g. `"ctx.db.readLatest"`) for log correlation.

---

## Capabilities, secrets, deployment

### Declaring secrets

```json
{
  "raindb": {
    "secrets": { "names": ["openai_api_key", "session-secret"] }
  }
}
```

Set the secret at deploy time:

```bash
raindb-cli --profile <yours> lightning secrets set openai_api_key \
  --value sk-... --bolt my-bolt
raindb-cli --profile <yours> lightning secrets set session-secret \
  --value $(openssl rand -hex 32) --bolt my-bolt
```

Read at runtime:

```typescript
import { secrets } from '@raindb/bolt-sdk';
const apiKey = await secrets.get('openai_api_key');
```

The secret's value lives in the `lightning-secrets` formation on the
bolt's host tenant, encrypted under the realm's KMS key. Bolt code
never sees the plaintext until `secrets.get` returns.

### Declaring formations

Two patterns:

**Reference an existing formation** (already on your tenant via a pack
install):

```json
{ "raindb": { "formations": [
  { "id": "fdn-chat-sessions", "ops": ["read", "write"] }
]}}
```

**Bundle a new formation in the bolt** (lands on the tenant at deploy):

```
bolt/formations/app-users/
  config.json          # FormationConfig: pathTemplate, schemaVersion, indexes
  schemas/v1.json      # JSON Schema for the payload
```

```json
// bolt/formations/app-users/config.json
{
  "formationId":   "app-users",
  "pathTemplate":  "tenants/{{.tenantId}}/entities/app-users/{{.scopeValue}}/{{.dropletId}}.json",
  "schemaVersion": "1.0.0",
  "indexes": [
    { "id": "by-id-latest",       "scope": "userId",   "keyType": "pointer-latest" },
    { "id": "by-username-latest", "scope": "username", "keyType": "pointer-latest" }
  ]
}
```

### deployment.json

```json
{
  "engine":      "goja",
  "entrypoint":  "dist/main.js",
  "mount":       "/",
  "healthcheck": "/api/health",
  "limits": {
    "cpuMs":    5000,
    "memoryMb": 128,
    "wallMs":   30000
  }
}
```

---

## Dev loop: local Vite + live deployed bolt

The most productive dev loop for a bolt with a frontend is to keep
the React app on `localhost` (Vite HMR) while pointing every API call
at the **already-deployed** bolt on your tenant. No local server, no
local key, no env file -- the live bolt holds its own secrets and
serves real data.

`vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Emit every asset as a hashed file under dist/assets/ instead
    // of inlining sub-4KB assets as data: URLs. The bolt mirrors
    // dist/assets/ to S3 as static droplets -- you want them as
    // files, not inlined into the JS bundle.
    assetsInlineLimit: 0,
  },
  server: {
    port: 4001,
    proxy: {
      '/api':  { target: 'https://<your-bolt>.<env>.raindb.gignit.com', changeOrigin: true, secure: true },
      '/auth': { target: 'https://<your-bolt>.<env>.raindb.gignit.com', changeOrigin: true, secure: true },
    },
  },
});
```

Iteration:

```bash
# 1. edit React code; Vite HMR pushes the change immediately
# 2. when satisfied, build + ship to the live bolt:
cd client && npm run build
rm -rf ../bolt/client/dist
cp -r dist ../bolt/client/dist
cd ../bolt
raindb-cli --profile <yours> lightning bolt deploy <bolt-name>
# ~5s -> the live URL now serves the new revision
```

**Cache gotcha:** the bolt sends `cache-control: max-age=60` on
`index.html` by default. Within a minute of `deploy`, the canonical
URL may still hand out the prior HTML. Append `?v=$(date +%s)` to
bust the cache when verifying, or just wait 60s. CSS/JS/image assets
are content-hashed so they don't have this problem.

---

## Compatibility + versioning

| `@raindb/bolt-sdk` | raindb-lightning bolt runtime      | `@raindb/agent`     |
|--------------------|-------------------------------------|---------------------|
| 0.1.x              | 1.0.x (initial LIVE bindings)       | 0.7.x (optional)    |
| 0.4.x              | 1.0.x + `ctx.auth` + `ctx.response` | 0.8.x               |
| 0.7.x (current)    | 1.0.x + `planStrategy` (range/scan) forward + native `writeToken` scopeValue + pod `listDroplets` scopeValue | 0.8.x |
| 1.0.x (target)     | 1.5.x (all gap cards landed)        | 1.0.x               |

Pin both `@raindb/bolt-sdk` and the bolt's lightning runtime to a
compatible row. The exported `VERSION` constant matches `package.json`
(`0.7.0`).

---

## Building

```sh
npm install
npm run lint        # tsc --noEmit on src + test
npm run test        # Tier 1 unit + Tier 3 shape-compat
npm run build       # produces dist/
npm pack            # produces a tarball with dist/, README.md, CHANGELOG.md only
```

Local unit and shape tests use an in-memory context and declared dependencies.
They require no private platform source, operator profile, or deployed fixture.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the standalone checks.

`test/integration/example-bolt/` contains example application source. Run its
own `npm run typecheck` separately; the root lint command covers SDK source and
unit tests. It is not a deployed integration suite. Running the example requires
your own tenant configuration and capabilities.

---

## Marketplace inventory

Use `raindb-cli pack list` to discover available application packs and
`raindb-cli pack info <vendor>/<pack>` to inspect a pack. Follow the pack's
published tenant instructions and declared capabilities. SDK development does
not require marketplace source repositories or platform administrator tools.

## See also

- [Contributing](CONTRIBUTING.md): independently runnable local checks.
- [SDK reference](BOLT_SDK_REFERENCE.md): public binding and result conventions.
- [Changelog](CHANGELOG.md): SDK changes.

## License

License terms are to be specified by the package owner. The SDK is intended
for RainDB application authors; this document does not grant a license.
