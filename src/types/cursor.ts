// types/cursor.ts -- pagination shapes shared by listKeys, listSince,
// catalog.list, etc. The Relay-shape (`first/after`/`last/before`)
// matches the substrate-side cursor protocol per audit §G.

/**
 * Relay-style cursor pagination options.
 *
 * Per audit §G (Gap 2), the substrate-side `listKeys` accepts:
 *   - asc: `first` (page size) + `after` (cursor)
 *   - desc: `last` (page size) + `before` (cursor)
 *   - `prefix` to narrow within the index
 *
 * Implementations decide which underlying primitive to call based on
 * which fields are populated. The wrapper passes the options through
 * unchanged.
 */
export interface CursorPaginationOpts {
  /** Forward pagination: max items to return after the cursor. */
  first?: number;
  /** Forward cursor; opaque string from a prior page's nextCursor. */
  after?: string;
  /** Reverse pagination: max items to return before the cursor. */
  last?: number;
  /** Reverse cursor; opaque string from a prior page's prevCursor. */
  before?: string;
  /** Optional prefix narrowing within the index. */
  prefix?: string;
  /**
   * Semantic entity identity for listDroplets. The host resolves the
   * formation's physical path encoding. Mutually exclusive with prefix.
   */
  scopeValue?: string;
}

/**
 * Generic cursor-paginated page. T is the row shape.
 */
export interface CursorPage<T> {
  readonly items: T[];
  readonly nextCursor?: string | null;
  readonly prevCursor?: string | null;
  readonly hasMore: boolean;
}
