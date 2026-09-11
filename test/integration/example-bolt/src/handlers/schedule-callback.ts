// handlers/schedule-callback.ts -- exercises ctx.schedule. LIVE since

import {
  schedule,
  log,
  RainDBBoltError,
  BindingNotInstalled,
} from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

// The action handler to dispatch when the schedule fires.  In a real
// bolt this would be wired as a separate exported handler reached via
// the `POST /__bolt/actions/{formationId}/{actionRef}` HTTP route the
// substrate's cyclone scheduler uses for promotion. This example only
// demonstrates the SCHEDULING side; the callback handler is left as a
// stub for the substrate to dispatch.
const FORMATION = 'agent-review-request';
const ACTION_REF = 'settle-review-deadline';
const DELAY_MS = 60_000;

export async function onScheduleCallback(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  const requestId =
    req.params['requestId'] ?? req.query['requestId'] ?? 'demo-request';

  try {
    const runAfterMs = Date.now() + DELAY_MS;
    const eventKey = await schedule.schedule({
      formationId: FORMATION,
      runAfterMs,
      actionRef: ACTION_REF,
      payload: { requestId },
    });

    log.info('schedule-callback', {
      formation: FORMATION,
      actionRef: ACTION_REF,
      runAfterMs,
      eventKey,
    });

    return {
      status: 200,
      body: {
        formation: FORMATION,
        actionRef: ACTION_REF,
        runAfterMs,
        eventKey,
        note: 'event will be promoted by the cyclone scheduler at runAfterMs',
      },
    };
  } catch (e) {
    if (e instanceof BindingNotInstalled) {
      return {
        status: 501,
        body: {
          error: 'ctx.schedule not installed on this lightning binary',
          hint:
            'requires a runtime providing this binding AND ' +
            '`capabilities.raindb.schedule: true` in bolt.json',
        },
      };
    }
    if (
      e instanceof RainDBBoltError &&
      /schedule capability not declared/.test((e as Error).message)
    ) {
      // Bolt-level capability denial -- the formation-shape regex
      // doesn't match, so the SDK falls through to RainDBBoltError.
      return {
        status: 403,
        body: {
          error: 'bolt missing schedule capability',
          hint:
            'set `capabilities.raindb.schedule: true` in bolt.json then republish',
        },
      };
    }
    throw e;
  }
}
