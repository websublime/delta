// ─────────────────────────────────────────────
//  delta:// — JSON model diff engine
//  Types & interfaces
// ─────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

// ── Operations ────────────────────────────────

/** A scalar or nested value was added at `path` */
export interface OpAdd {
  op: 'add';
  path: string;
  value: JsonValue;
}

/** A scalar or nested value was removed at `path` */
export interface OpRemove {
  op: 'remove';
  path: string;
  oldValue: JsonValue;
}

/** A value at `path` was replaced (type or scalar change) */
export interface OpReplace {
  op: 'replace';
  path: string;
  value: JsonValue;
  oldValue: JsonValue;
}

/**
 * An array item was moved within the same array.
 * `path` = array root (e.g. `/items`).
 * Applied AFTER removes and BEFORE adds.
 */
export interface OpMove {
  op: 'move';
  path: string; // array root path
  fromIndex: number; // index in original (after prior removes)
  toIndex: number; // index in final array
  value: JsonValue; // final value of the item
  oldValue: JsonValue; // original value (may differ if item also changed)
}

export type DiffOp = OpAdd | OpRemove | OpReplace | OpMove;

// ── Summary ───────────────────────────────────

export interface DiffSummary {
  added: number;
  removed: number;
  replaced: number;
  moved: number;
  /** moves that also carried value changes */
  movedAndChanged: number;
  total: number;
}

// ── Result ────────────────────────────────────

export interface DiffResult {
  hasChanges: boolean;
  operations: DiffOp[];
  summary: DiffSummary;
  /** Paths that were changed (for quick lookup) */
  changedPaths: Set<string>;
}

// ── Options ───────────────────────────────────

/**
 * Identity resolver for array items.
 * - `string`   — use a single object key  (e.g. `'id'`)
 * - `string[]` — composite key            (e.g. `['namespace', 'name']`)
 * - `function` — custom resolver          (receives item + original index)
 */
export type IdentityFn = (item: JsonValue, index: number) => string | number;
export type IdentityKey = string | string[];
export type Identity = IdentityKey | IdentityFn;

export interface DiffOptions {
  /**
   * Identity resolver for array items.
   *
   * Supports three forms:
   * ```
   * arrayIdentity: 'id'                       // global: all arrays use key 'id'
   * arrayIdentity: ['org', 'repo']             // global: composite key
   * arrayIdentity: { '/items': 'id',           // per-path
   *                  '/tags':  'name' }
   * ```
   * Without this, arrays are diffed positionally (LCS).
   */
  arrayIdentity?: Identity | Record<string, Identity>;

  /**
   * Custom equality function. Defaults to structural deep-equal.
   * Useful for ignoring certain fields in comparisons:
   * ```
   * equal: (a, b) => JSON.stringify(a) === JSON.stringify(b)
   * ```
   */
  equal?: (a: JsonValue, b: JsonValue) => boolean;

  /**
   * Detect and emit `move` operations for identity-keyed arrays.
   * When `false`, reorders appear as remove + add pairs.
   * @default true
   */
  detectMoves?: boolean;

  /**
   * Maximum recursion depth. Beyond this, values are compared
   * as opaque blobs (deep-equal → replace if different).
   * @default Infinity
   */
  maxDepth?: number;

  /**
   * JSON Pointer paths to skip entirely.
   * Supports exact match and prefix match with trailing `/*`.
   * ```
   * ignore: ['/meta/updatedAt', '/audit/*']
   * ```
   */
  ignore?: string[];

  /**
   * When `true` (default), `value` and `oldValue` on emitted operations are
   * deep-cloned from the input documents. This makes the `DiffResult` fully
   * independent from its inputs.
   *
   * When `false`, those fields hold references into the inputs.
   * This reduces memory footprint by roughly 2× on large diffs, **but**:
   * - Mutating `op.value`/`op.oldValue` will mutate the original input.
   * - Mutating the inputs after `diff()` will poison the `DiffResult`.
   *
   * `patch()` and `unpatch()` still clone when applying, so their return
   * values remain independent from the inputs even with `cloneValues: false`.
   *
   * @default true
   */
  cloneValues?: boolean;
}

// ── Internal resolved options ─────────────────

export interface ResolvedOptions {
  getIdentity: (path: string, item: JsonValue, index: number) => string | number | null;
  equal: (a: JsonValue, b: JsonValue) => boolean;
  detectMoves: boolean;
  maxDepth: number;
  ignore: Set<string>;
  ignorePrefix: string[];
  cloneValues: boolean;
}
