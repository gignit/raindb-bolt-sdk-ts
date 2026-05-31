// handlers/sql-probe.ts -- exercises sql.query against a trivial
// statement. LIVE since v0.2.0 (substrate commit af5e9eb).
//
// Demonstrates the positional row shape: `result.rows` is
// `unknown[][]` (each row is an array aligned with the `columns[]`
// order). To look up a named column, compute `columns.indexOf(name)`
// once and index each row by the resulting position.
//
// Capability: bolt.json must set `capabilities.raindb.sqlRead: true`.

import { sql, log, CapabilityDenied, BindingNotInstalled } from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

export async function onSqlProbe(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  void req;

  try {
    const result = await sql.query({
      sql: "SELECT 1 AS one, 'hello' AS greeting",
    });
    const oneIdx = result.columns.indexOf('one');
    const greetingIdx = result.columns.indexOf('greeting');
    const one = result.rows[0]?.[oneIdx] ?? null;
    const greeting = result.rows[0]?.[greetingIdx] ?? null;

    log.info('sql-probe done', {
      rowCount: result.rowCount,
      durationMs: result.durationMs,
      truncated: result.truncated,
    });

    return {
      status: 200,
      body: {
        columns: result.columns,
        rowCount: result.rowCount,
        durationMs: result.durationMs,
        truncated: result.truncated,
        one,
        greeting,
        // latest is undefined in the Tier 1 substrate cut (deferred
        // per substrate brain doc decision 4). Surface as a hint.
        latestPresent: result.latest !== undefined,
      },
    };
  } catch (e) {
    if (e instanceof CapabilityDenied) {
      return {
        status: 403,
        body: {
          error: 'bolt missing capability',
          op: e.op,
          hint: 'set capabilities.raindb.sqlRead: true in bolt.json',
        },
      };
    }
    if (e instanceof BindingNotInstalled) {
      return {
        status: 501,
        body: {
          error: 'ctx.sql not installed on this lightning binary',
          hint: 'requires substrate >= phoenix commit af5e9eb',
        },
      };
    }
    throw e;
  }
}
