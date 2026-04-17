// ─────────────────────────────────────────────
//  delta:// — JSON model diff engine
//  Types & interfaces
// ─────────────────────────────────────────────

/** JSON primitive value: string, number, boolean, or null. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Any valid JSON value: a primitive, an object, or an array.
 * This is the top-level value type used throughout the diff engine.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** A plain JSON object with string keys and JSON values. */
export type JsonObject = { [key: string]: JsonValue };

/** A JSON array of arbitrary JSON values. */
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
 *
 * **Design note — moved-and-changed items:**
 * When an item moves AND its contents change, a single `move` op is emitted
 * carrying the full `value` (after) and `oldValue` (before). Granular
 * sub-field diffs are **not** emitted alongside the move. This is intentional:
 * emitting nested ops at the destination index would produce paths that refer
 * to different items after reverse reconstruction, breaking {@link unpatch}.
 *
 * To inspect which fields changed within a moved item, diff `op.oldValue`
 * against `op.value`:
 * ```ts
 * if (!deepEqual(op.value, op.oldValue)) {
 *   const fieldDiff = diff(op.oldValue, op.value);
 * }
 * ```
 */
export interface OpMove {
  op: 'move';
  path: string; // array root path
  fromIndex: number; // index in original (after prior removes)
  toIndex: number; // index in final array
  value: JsonValue; // final value of the item
  oldValue: JsonValue; // original value (may differ if item also changed)
}

/**
 * Discriminated union of all diff operation types.
 *
 * Narrow on `op.op` to access type-specific fields:
 * ```ts
 * for (const op of result.operations) {
 *   switch (op.op) {
 *     case 'add':     // op is OpAdd
 *     case 'remove':  // op is OpRemove
 *     case 'replace': // op is OpReplace
 *     case 'move':    // op is OpMove
 *   }
 * }
 * ```
 */
export type DiffOp = OpAdd | OpRemove | OpReplace | OpMove;

// ── Summary ───────────────────────────────────

/**
 * Aggregate counters for a diff, broken down by operation type.
 *
 * Every field counts the number of operations of that kind. `total` is
 * the sum of all operation counts.
 */
export interface DiffSummary {
  /** Number of `add` operations. */
  added: number;
  /** Number of `remove` operations. */
  removed: number;
  /** Number of `replace` operations. */
  replaced: number;
  /** Number of `move` operations (including those that also changed). */
  moved: number;
  /** Moves where `value !== oldValue` — the item changed while being reordered. */
  movedAndChanged: number;
  /** Total number of operations across all types. */
  total: number;
}

// ── Result ────────────────────────────────────

/**
 * The result of a {@link diff} call.
 *
 * Contains the full list of operations, a statistical summary, and a set of
 * changed paths for quick membership tests.
 */
export interface DiffResult {
  /** `true` when at least one operation was emitted. */
  hasChanges: boolean;
  /** Ordered list of diff operations. */
  operations: DiffOp[];
  /** Aggregate counters broken down by operation type. */
  summary: DiffSummary;
  /**
   * Set of JSON Pointer paths that were touched by at least one operation.
   * Useful for quick `has()` look-ups without scanning the operations array.
   */
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

// ── Changes ──────────────────────────────────

/**
 * Result returned by {@link changes} and {@link changesFromDiff}.
 *
 * Provides a sparse representation of what changed between two documents,
 * split into values that were set (added, replaced, or moved) and paths
 * that were removed.
 *
 * @example
 * ```ts
 * const before = { name: 'Alice', age: 30, email: 'a@b.c' };
 * const after  = { name: 'Bob',   age: 30 };
 *
 * const result = changes(before, after);
 * result.updated  // → { name: 'Bob' }
 * result.removed  // → ['/email']
 * ```
 */
export interface ChangesResult {
  /** `true` when at least one change was detected. */
  hasChanges: boolean;

  /**
   * Sparse object containing only the values that were **added**, **replaced**,
   * or **moved** (at their destination index). Preserves nested structure —
   * intermediate containers are plain objects even for array indices.
   *
   * `null` when no additions, replacements, or moves exist (i.e. only removals).
   */
  updated: JsonValue | null;

  /**
   * RFC 6901 JSON Pointer paths that were **removed** from the source document.
   * The list is in the same order the remove operations appear in the diff.
   */
  removed: string[];

  /**
   * The complete {@link DiffResult} for low-level operation access.
   * Useful when you need the full operation list, summary counters, or
   * the `changedPaths` set beyond what `updated` / `removed` provide.
   */
  diff: DiffResult;
}

// ── Internal resolved options ─────────────────

/**
 * Normalised and compiled form of {@link DiffOptions}, used internally by the
 * diff engine. Produced by `resolveOptions()` in `diff.ts`.
 */
export interface ResolvedOptions {
  /** Compiled identity resolver — returns `null` when the path has no identity. */
  getIdentity: (path: string, item: JsonValue, index: number) => string | number | null;
  /** Equality function used for value comparison. */
  equal: (a: JsonValue, b: JsonValue) => boolean;
  /** Whether to emit `move` operations for reordered identity-keyed items. */
  detectMoves: boolean;
  /** Maximum recursion depth before treating sub-trees as opaque blobs. */
  maxDepth: number;
  /** Exact paths to ignore. */
  ignore: Set<string>;
  /** Path prefixes to ignore (derived from `ignore` entries ending with `/*`). */
  ignorePrefix: string[];
  /** Whether to deep-clone values stored on emitted operations. */
  cloneValues: boolean;
}
