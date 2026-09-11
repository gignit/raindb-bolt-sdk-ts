// bindings/secrets.ts -- typed wrapper for ctx.secrets.get.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';

/**
 * Bolt-facing shape of `ctx.secrets`. Single method `get(name)`.
 */
export interface SecretsBinding {
  get(name: string): Promise<string>;
}

/**
 * Read a tenant secret declared in the bolt manifest.
 *
 * LIVE binding.
 *
 * @requires capability: name MUST be in `capabilities.raindb.secrets.names`
 * @throws RainDBBoltError when the name is undeclared (substrate
 *   side rejects with a generic error message; the wrapper surfaces
 *   it as RainDBBoltError because there's no typed-name discriminator)
 *
 * @example
 * ```ts
 * const apiKey = await secrets.get('upstream-api-key');
 * const resp = await fetch('https://api.example.com/things', {
 *   headers: { 'Authorization': `Bearer ${apiKey}` },
 * });
 * ```
 */
export const secrets = {
  async get(name: string): Promise<string> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.secrets.get(name);
      return String(out);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.secrets_get,
        input: { name },
      });
    }
  },
};
