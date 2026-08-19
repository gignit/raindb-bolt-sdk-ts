// runtime/graphql.ts -- the bolt-side GraphQL-over-ctx.fetch client.
//
// A few RainDB operations are intentionally NOT native goja/pod bindings --
// they are LOW-FREQUENCY (file upload/download reservation, exact
// version-history listing). Rather than a dedicated native fast-path, the SDK
// runs them over the RainDB GraphQL API via ctx.fetch. This module is the one
// place that does that, so the file (and any future graphql-backed) bindings
// share one client -- the bolt-sdk analog of @raindb/agent's executeGraphQL.
//
// Endpoint + key resolution follows the SAME convention the rest of the SDK
// uses for HTTP-over-ctx.fetch (see agent-bridge chatCompletionViaCtxFetch,
// which reads LLM_API_BASE/LLM_API_KEY secrets): the bolt declares the RainDB
// GraphQL endpoint + a tenant-scoped key as secrets, named
// RAINDB_GRAPHQL_ENDPOINT + RAINDB_GRAPHQL_KEY. Both MUST be declared in
// capabilities.json raindb.secrets.names, and the endpoint host MUST be in
// network.fetch.allowedHosts (ctx.fetch is egress-allowlisted).

import { fetch as ctxFetch } from '../bindings/fetch.js';
import { secrets } from '../bindings/secrets.js';
import { RainDBBoltError } from '../errors/classes.js';

/** Canonical secret names the graphql-over-ctx.fetch route reads. */
export const GRAPHQL_ENDPOINT_SECRET = 'RAINDB_GRAPHQL_ENDPOINT';
export const GRAPHQL_KEY_SECRET = 'RAINDB_GRAPHQL_KEY';

async function resolveGraphQLConfig(): Promise<{ endpoint: string; key: string }> {
  let endpoint = '';
  let key = '';
  try {
    endpoint = await secrets.get(GRAPHQL_ENDPOINT_SECRET);
  } catch {
    // fall through to the unified error below
  }
  try {
    key = await secrets.get(GRAPHQL_KEY_SECRET);
  } catch {
    // fall through
  }
  if (!endpoint || !key) {
    throw new RainDBBoltError(
      `graphql-over-ctx.fetch route not configured: declare + stage the ` +
        `${GRAPHQL_ENDPOINT_SECRET} and ${GRAPHQL_KEY_SECRET} secrets ` +
        `(capabilities.json raindb.secrets.names) and add the endpoint host to ` +
        `network.fetch.allowedHosts. This route serves the low-frequency ops ` +
        `(file upload/download reservation) that have no native binding.`,
      { binding: 'runtime.graphql' },
    );
  }
  return { endpoint, key };
}

/**
 * POST a GraphQL operation to the RainDB API over ctx.fetch and return its
 * `data` field. Throws RainDBBoltError on transport, non-JSON, or GraphQL
 * errors. Used by the file bindings; reusable by any future graphql-backed
 * low-frequency helper.
 */
export async function boltGraphQL<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const { endpoint, key } = await resolveGraphQLConfig();
  const res = await ctxFetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  // ctx.fetch's FetchResponse carries the body as a STRING (not a .text()
  // method); see bindings/fetch.ts FetchResponse.
  const text = (res as { body?: string }).body ?? '';
  let parsed: { data?: T; errors?: Array<{ message: string }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RainDBBoltError(
      `RainDB GraphQL returned non-JSON (status ${res.status}): ${String(text).slice(0, 200)}`,
      { binding: 'runtime.graphql' },
    );
  }
  if (parsed.errors && parsed.errors.length > 0) {
    throw new RainDBBoltError(
      `RainDB GraphQL error: ${parsed.errors.map((e) => e.message).join('; ')}`,
      { binding: 'runtime.graphql' },
    );
  }
  if (!parsed.data) {
    throw new RainDBBoltError('RainDB GraphQL response had no data', {
      binding: 'runtime.graphql',
    });
  }
  return parsed.data;
}
