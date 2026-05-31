// runtime/index.ts -- public runtime exports.
//
// Bolts import { setCtx } from '@raindb/bolt-sdk' (the runtime helper
// is also re-exported from the top-level for ergonomic reasons --
// see src/index.ts). This subpath is the explicit-import surface for
// authors who prefer keeping runtime concerns out of the binding
// imports.

export { setCtx } from './ctx-resolver.js';
