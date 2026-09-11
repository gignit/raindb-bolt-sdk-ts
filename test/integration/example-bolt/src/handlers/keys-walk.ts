// handlers/keys-walk.ts -- exercises db.listKeys with paging.

import { db, log, CapabilityDenied, BindingNotInstalled } from '@raindb/bolt-sdk';
import type {
  BoltContext,
  BoltRequest,
  BoltResponse,
  KeyEntry,
} from '@raindb/bolt-sdk';

const FORMATION = 'agent-graph';
const INDEX = 'by-id-latest';
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

export async function onKeysWalk(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  void req;
  const accumulated: KeyEntry[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;

  try {
    for (;;) {
      const page = await db.listKeys({
        formationId: FORMATION,
        indexId: INDEX,
        opts: {
          first: PAGE_SIZE,
          ...(cursor !== undefined ? { after: cursor } : {}),
        },
      });
      for (const k of page.keys) accumulated.push(k);
      pagesFetched += 1;
      if (!page.hasMore || pagesFetched >= MAX_PAGES) break;
      cursor = page.nextCursor ?? undefined;
      if (cursor === undefined) break;
    }

    log.info('keys-walk done', {
      formation: FORMATION,
      index: INDEX,
      pagesFetched,
      keyCount: accumulated.length,
    });

    return {
      status: 200,
      body: {
        formation: FORMATION,
        index: INDEX,
        pagesFetched,
        keyCount: accumulated.length,
        // Surface the first few keys for visibility; the full list
        // would be too large for a healthy API response.
        sample: accumulated.slice(0, 5).map((k) => ({
          key: k.key,
          size: k.size,
          lastModified: k.lastModified,
          ...(k.etag !== undefined ? { etag: k.etag } : {}),
        })),
      },
    };
  } catch (e) {
    if (e instanceof CapabilityDenied) {
      return {
        status: 403,
        body: {
          error: 'bolt missing capability',
          op: e.op,
          formation: e.formationId,
        },
      };
    }
    if (e instanceof BindingNotInstalled) {
      return {
        status: 501,
        body: {
          error: 'ctx.db.listKeys not installed on this lightning binary',
          hint: 'requires a runtime providing this binding',
        },
      };
    }
    throw e;
  }
}
