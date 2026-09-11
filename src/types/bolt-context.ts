// types/bolt-context.ts -- the central type contract.

import type { DbBinding } from '../bindings/db.js';
import type { LogBinding } from '../bindings/log.js';
import type { FetchBinding } from '../bindings/fetch.js';
import type { SecretsBinding } from '../bindings/secrets.js';
import type { IdsBinding } from '../bindings/ids.js';
import type { JwtBinding } from '../bindings/jwt.js';
import type { CryptoBinding } from '../bindings/crypto.js';
import type { CookiesBinding } from '../bindings/cookies.js';
import type { IamBinding } from '../bindings/iam.js';
import type { AuthBinding } from '../bindings/auth.js';
import type { ResponseBinding } from '../bindings/response.js';
import type { TokenBinding } from '../bindings/token.js';
import type { StatsBinding } from '../bindings/stats.js';
import type { ObjectsBinding } from '../bindings/objects.js';
import type { SqlBinding } from '../bindings/sql.js';
import type { RelayBinding } from '../bindings/relay.js';
import type { ActionsBinding } from '../bindings/actions.js';
import type { TagsBinding } from '../bindings/tags.js';
import type { VectorsBinding } from '../bindings/vectors.js';
import type { FilesBinding } from '../bindings/files.js';
import type { CatalogBinding } from '../bindings/catalog.js';
import type { FormationsBinding } from '../bindings/formations.js';
import type { FlowsBinding } from '../bindings/flows.js';
import type { ScheduleBinding } from '../bindings/schedule.js';

/**
 * Static metadata about the bolt itself. Surfaced by the goja
 * sandbox at invocation time. Per audit §S (Gap 14), three fields
 * (`standardBucket`, `publicBucket`, `region`) are not yet exposed
 * on `ctx.bolt`; they're typed optional here. When the substrate
 * ships them they become required in a minor version bump.
 *
 * Optional fields may be unavailable in a runtime; check before use.
 */
export interface BoltMeta {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  readonly tenantId: string;
  /** STUB (audit §S Gap 14). Optional until substrate ships. */
  readonly standardBucket?: string;
  /** STUB (audit §S Gap 14). Optional until substrate ships. */
  readonly publicBucket?: string;
  /** STUB (audit §S Gap 14). Optional until substrate ships. */
  readonly region?: string;
}

/**
 * The argument every bolt handler accepts. Maps 1:1 to what the
 * goja sandbox actually produces; field names are the goja-side
 * names (no renames).
 *
 * @example
 * ```ts
 * import { setCtx, db, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';
 *
 * export async function onHttpRequest(
 *   ctx: BoltContext,
 *   req: BoltRequest,
 * ): Promise<BoltResponse> {
 *   setCtx(ctx);
 *   const id = req.params['id'];
 *   const droplet = await db.readLatest({
 *     formationId: 'agent-graph',
 *     indexId: 'by-id',
 *     scopeValue: id ?? '',
 *   });
 *   return { status: 200, body: droplet ?? { error: 'not found' } };
 * }
 * ```
 */
export interface BoltContext {
  readonly bolt: BoltMeta;

  // --- LIVE bindings (shipped in substrate v1.0.x; see audit §B) ---
  readonly log: LogBinding;
  readonly db: DbBinding;
  readonly fetch: FetchBinding;
  readonly secrets: SecretsBinding;
  readonly ids: IdsBinding;
  readonly jwt: JwtBinding;
  readonly crypto: CryptoBinding;
  readonly cookies: CookiesBinding;
  readonly iam: IamBinding;
  /**
   * Per-request authentication surface. Read-only view onto the
   * AuthContext the lightning dispatcher resolved at request
   * boundary via the SAME GrantValidator raindb-api's
   * auth_middleware uses.
   *
   * LIVE since v0.4.0. Marked
   * optional because the namespace can be unavailable; the wrapper
   * guards by checking `ctx.auth !== undefined` before reading
   * scalars / invoking predicates and returns the safe defaults
   * (empty strings, false) when missing.
   *
   * See bindings/auth.ts for the public surface contract.
   */
  readonly auth?: AuthBinding;
  /**
   * Streaming response surface. Present only when the handler is
   * dispatched on a `streaming: true` route; for non-streaming
   * handlers this is undefined (the handler returns a BoltResponse
   * normally).
   */
  readonly response?: ResponseBinding;

  // --- STUBBED bindings (substrate-side pending; see audit §F-§S) ---
  readonly token?: TokenBinding;
  readonly stats?: StatsBinding;
  readonly objects?: ObjectsBinding;
  readonly sql?: SqlBinding;
  readonly relay?: RelayBinding;
  readonly actions?: ActionsBinding;
  /**
   * Type-only namespace -- the substrate does NOT install a
   * `ctx.tags` namespace today (Wave 2 Tier 2 routed tag mutations
   * through `ctx.db.tag` / `ctx.db.untag` instead). This field
   * stays declared optional for backwards-compat with the v0.1
   * type imports; the SDK's `tags.*` wrappers route through
   * `db.*`. See `bindings/tags.ts` for the rationale.
   */
  readonly tags?: TagsBinding;
  readonly vectors?: VectorsBinding;
  readonly files?: FilesBinding;
  readonly catalog?: CatalogBinding;
  readonly formations?: FormationsBinding;
  readonly flows?: FlowsBinding;
  /**
   * LIVE since v0.3.0. The
   * top-level callable enqueues a deferred bolt-callback. Marked
   * optional because the namespace can be unavailable; the wrapper
   * guards with a clean BindingNotInstalled.
   */
  readonly schedule?: ScheduleBinding;
}

/**
 * The HTTP-shaped request payload passed to handlers.
 *
 * Trigger-style invocations leave HTTP fields empty and
 * populate `trigger` instead -- see {@link BoltTriggerRequest}.
 */
export interface BoltRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly query: Readonly<Record<string, string | string[]>>;
  /** Raw request body as text. Empty string for GET/HEAD. */
  readonly body?: string;
  /**
   * Convenience pre-parsed JSON body. Populated when
   * `headers['content-type']` matches `application/json` and the
   * body parses cleanly. Otherwise undefined; handlers that need
   * different parsers fall through to `body`.
   */
  readonly json?: unknown;
}

/**
 * The trigger-shaped invocation payload. Mutually exclusive with
 * the HTTP fields on {@link BoltRequest}; trigger handlers receive
 * this shape instead.
 */
export interface BoltTriggerRequest {
  readonly trigger: {
    readonly kind: string;
    readonly payload: Record<string, unknown>;
  };
}

/**
 * The handler's return value. The goja sandbox accepts any object
 * with `status` / `headers` / `body` and dispatches accordingly.
 *
 * For streaming handlers, the handler instead calls `response.write()`
 * during execution and returns an empty object (status defaults 200).
 * Mixing streaming with a non-empty body in the return value is a
 * handler bug (the engine rejects with a typed error -- see
 * `runtime/engine.go::InvocationResult.Streamed` for the contract).
 *
 * `body` is typed as `unknown` to accept any JSON-serializable value
 * the handler returns -- typed droplet shapes, ad-hoc objects,
 * primitives, raw bytes. The substrate serializes via `json.Marshal`.
 */
export interface BoltResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  /**
   * Read-only marker set by `ctx.response.write(...)` invocations.
   * Handlers MUST NOT set this; the engine populates it on the
   * `InvocationResult` returned to the dispatcher.
   */
  readonly streamed?: boolean;
}
