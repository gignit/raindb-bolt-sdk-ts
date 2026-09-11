// bindings/response.ts -- typed wrapper for ctx.response.{write,setHeader,beginStream}.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';
import { RainDBBoltError } from '../errors/classes.js';
import type { BoltContext, BoltResponse } from '../types/bolt-context.js';

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

/** One Server-Sent Event frame. */
export interface SSEFrame {
  event: string;
  data: unknown;
}

/**
 * A started SSE stream. `send` emits one frame; `finalize` returns the
 * BoltResponse the handler must return (empty body on the streaming path, the
 * buffered frames on the non-streaming fallback).
 */
export interface SSEStream {
  /** Emit one SSE frame -- live over the wire on a streaming route, buffered otherwise. */
  send(event: string, data: unknown): void;
  /**
   * Return the BoltResponse to hand back from the handler. On a streaming route
   * this is an empty body (bytes already went out via ctx.response.write); on a
   * non-streaming route it is the buffered event-stream body.
   */
  finalize(): BoltResponse;
}

/** Serialize a frame to the SSE wire format (`event:` + `data:` + blank line). */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Start a Server-Sent Events stream, owning the streaming-vs-buffered branch
 * that every SSE bolt otherwise hand-rolls (see the pattern in fdn-app's
 * bolt/server/routes/chat.ts: frameToString + sseResponse + finalizeSSE + the
 * send() closure). The RainDB construct -- "is ctx.response wired? set the
 * event-stream headers, write live; else buffer and return a single body" --
 * lives here, so a handler just does:
 *
 * ```ts
 * const sse = await startSSE(ctx);
 * sse.send('thinking', { i: 1 });
 * sse.send('final', { content });
 * return sse.finalize();
 * ```
 *
 * On a route declaring `streaming: true`, headers are set + the stream begins
 * and each send() hits the wire immediately. On a non-streaming route it buffers
 * every frame and finalize() returns them as one text/event-stream body -- the
 * same handler works on both.
 *
 * @param ctx the bolt context (only its `response` presence is inspected)
 */
export async function startSSE(ctx: BoltContext): Promise<SSEStream> {
  const streaming = ctx.response !== undefined;
  const frames: string[] = [];

  if (streaming) {
    await response.setHeader('content-type', 'text/event-stream');
    await response.setHeader('cache-control', 'no-cache, no-transform');
    await response.setHeader('connection', 'keep-alive');
    await response.beginStream(200);
  }

  return {
    send(event: string, data: unknown): void {
      const wire = sseFrame(event, data);
      if (streaming) {
        // Fire-and-forget: the write is ordered by the goja event loop.
        void response.write(wire);
      } else {
        frames.push(wire);
      }
    },
    finalize(): BoltResponse {
      if (streaming) {
        return { status: 200, headers: {}, body: '' };
      }
      return {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
        body: frames.join(''),
      };
    },
  };
}
