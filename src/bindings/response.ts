// bindings/response.ts -- typed wrapper for ctx.response.{write,setHeader,beginStream}.
//
// LIVE binding (audit §B; SSE Phase 8).
// Maps onto
// `pkg/lightning/engines/goja/bindings.go::installResponseBinding`.
//
// The binding is present ONLY when the dispatcher passed a
// StreamingWriter on this invocation -- i.e. the bolt declared
// `streaming: true` on its route. For non-streaming handlers,
// ctx.response is undefined and this wrapper's calls fail with a
// clear "streaming not enabled" message.
//
// Headers MUST be set BEFORE the first write. The substrate
// commits status + headers on the first byte to wire; calling
// setHeader after a write panics on the goja side.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';
import { RainDBBoltError } from '../errors/classes.js';

/**
 * Bolt-facing shape of `ctx.response` -- the raw goja-installed
 * streaming surface.
 */
export interface ResponseBinding {
  setHeader(name: string, value: string): Promise<void> | void;
  beginStream(status?: number): Promise<void> | void;
  /**
   * Write a chunk to the stream. Returns the byte count written for
   * parity with Node's `response.write()`.
   */
  write(chunk: string | Uint8Array): Promise<number> | number;
}

/**
 * Streaming response surface. Used by SSE bolts, chat-token-stream
 * bolts, log-tail bolts -- any handler that needs progressive
 * responses instead of a single bundled body.
 */
export const response = {
  /**
   * Set a response header. Must be called BEFORE the first
   * `response.write()` -- the substrate commits headers on the first
   * byte that hits the wire.
   *
   * LIVE binding (only present when route declares `streaming: true`).
   *
   * @throws RainDBBoltError when streaming isn't enabled OR when
   *   called after the stream has begun
   *
   * @example
   * ```ts
   * response.setHeader('content-type', 'text/event-stream');
   * response.setHeader('cache-control', 'no-cache');
   * response.write('event: hello\ndata: {}\n\n');
   * ```
   */
  async setHeader(name: string, value: string): Promise<void> {
    const ctx = resolveCtx();
    if (!ctx.response) {
      throw new RainDBBoltError(
        'ctx.response.setHeader: streaming is not enabled on this route. ' +
          'Add `streaming: true` to the route in bolt.json to enable.',
        { binding: BINDING.response_setHeader },
      );
    }
    try {
      await ctx.response.setHeader(name, value);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.response_setHeader,
        input: { name },
      });
    }
  },

  /**
   * Explicitly begin the stream with the given status. Optional --
   * the first `write()` infers status 200 if not called.
   *
   * LIVE binding.
   *
   * @throws RainDBBoltError when streaming isn't enabled
   */
  async beginStream(status?: number): Promise<void> {
    const ctx = resolveCtx();
    if (!ctx.response) {
      throw new RainDBBoltError(
        'ctx.response.beginStream: streaming is not enabled on this route.',
        { binding: BINDING.response_beginStream },
      );
    }
    try {
      if (status !== undefined) await ctx.response.beginStream(status);
      else await ctx.response.beginStream();
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.response_beginStream,
        input: { status },
      });
    }
  },

  /**
   * Write a chunk to the response stream. Implicitly calls
   * `beginStream(200)` on the first invocation if not already called.
   *
   * Returns the byte count written (parity with Node's
   * `ServerResponse.write()`).
   *
   * LIVE binding.
   *
   * @throws RainDBBoltError when streaming isn't enabled or the
   *   client has disconnected
   *
   * @example
   * ```ts
   * for await (const token of llmStream) {
   *   response.write(`data: ${JSON.stringify({ token })}\n\n`);
   * }
   * response.write('event: done\ndata: {}\n\n');
   * ```
   */
  async write(chunk: string | Uint8Array): Promise<number> {
    const ctx = resolveCtx();
    if (!ctx.response) {
      throw new RainDBBoltError(
        'ctx.response.write: streaming is not enabled on this route. ' +
          'Add `streaming: true` to the route in bolt.json to enable.',
        { binding: BINDING.response_write },
      );
    }
    try {
      const n = await ctx.response.write(chunk);
      return Number(n);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.response_write,
        input: undefined,
      });
    }
  },
};
