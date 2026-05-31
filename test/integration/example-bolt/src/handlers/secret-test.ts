// handlers/secret-test.ts -- exercises secrets, jwt, crypto, cookies, fetch.

import {
  cookies,
  crypto,
  fetch,
  jwt,
  log,
  secrets,
} from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

export async function onSecretTest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;

  // 1. Read a secret.
  const upstream = await secrets.get('upstream-key');
  log.info('upstream key length', { len: upstream.length });

  // 2. Use it as an Authorization header on an outbound fetch.
  //    (api.example.com is in the manifest's network.egress allowlist.)
  const resp = await fetch('https://api.example.com/v1/ping', {
    headers: { authorization: `Bearer ${upstream}` },
  });
  log.info('upstream ping', { status: resp.status });

  // 3. Sign a session JWT.
  const token = await jwt.sign('session-secret', { sub: 'demo-user' }, 3600);

  // 4. Verify it round-trips.
  const claims = await jwt.verify('session-secret', token);
  log.info('jwt claims', { claims });

  // 5. Hash a password sample.
  const hash = await crypto.hashPassword('hunter2');
  const ok = await crypto.verifyPassword('hunter2', hash);

  // 6. Build a Set-Cookie header.
  const setCookie = await cookies.build('session', token, {
    path: '/',
    maxAge: 3600,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  });

  // 7. Parse a Cookie header.
  const jar = await cookies.parse(`session=${token}`);

  // 8. Generate a CSRF nonce.
  const csrf = await crypto.randomBytes(16);

  return {
    status: 200,
    headers: { 'set-cookie': setCookie },
    body: {
      passwordRoundTrip: ok,
      cookieParsed: jar['session'] === token,
      csrfNonce: csrf,
      upstreamStatus: resp.status,
    },
  };
}

// Reference req to silence unused warning even though the handler
// doesn't read body.
export const __reqType: BoltRequest | undefined = undefined;
