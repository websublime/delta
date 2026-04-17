// ─────────────────────────────────────────────
//  delta:// — core diff engine
// ─────────────────────────────────────────────

import { lcsArrayDiff } from './lcs.js';
import type {
  DiffOp,
  DiffOptions,
  DiffResult,
  DiffSummary,
  Identity,
  IdentityFn,
  JsonObject,
  JsonValue,
  OpAdd,
  OpMove,
  OpRemove,
  ResolvedOptions,
} from './types.js';
import { cloneDeep, deepEqual, isArray, isObject, joinPath } from './utils.js';

// ── Option resolution ─────────────────────────

/**
 * Compile an {@link Identity} descriptor into a callable {@link IdentityFn}.
 *
 * - `string`   → single-key getter (e.g. `'id'` → `item => item.id`)
 * - `string[]` → composite-key getter joined with `::` separator
 * - `function` → returned as-is
 *
 * Primitive (non-object) items always resolve to the sentinel `'__primitive__'`.
 */
function resolveIdentityFn(identity: Identity): IdentityFn {
  if (typeof identity === 'function') return identity;

  if (typeof identity === 'string') {
    const key = identity;
    return (item) => {
      if (isObject(item)) return String(item[key] ?? '__undefined__');
      return '__primitive__';
    };
  }

  // string[] — composite key
  const keys = identity;
  return (item) => {
    if (!isObject(item)) return '__primitive__';
    return keys.map((k) => String(item[k] ?? '')).join('::');
  };
}

/**
 * Normalise raw {@link DiffOptions} into a {@link ResolvedOptions} struct.
 *
 * Compiles identity descriptors into callable functions, builds the ignore
 * set and prefix list, and applies defaults for every optional field.
 */
function resolveOptions(opts: DiffOptions = {}): ResolvedOptions {
  const rawIdentity = opts.arrayIdentity;
  let getIdentity: ResolvedOptions['getIdentity'];

  if (!rawIdentity) {
    getIdentity = () => null;
  } else if (
    typeof rawIdentity === 'object' &&
    !Array.isArray(rawIdentity) &&
    typeof rawIdentity !== 'function'
  ) {
    // Record<path, Identity> — per-path map
    const map = rawIdentity as Record<string, Identity>;
    const compiled: Record<string, IdentityFn> = {};
    for (const [p, id] of Object.entries(map)) {
      compiled[p] = resolveIdentityFn(id);
    }
    getIdentity = (path, item, idx) => {
      const fn = compiled[path];
      return fn ? fn(item, idx) : null;
    };
  } else {
    // Global identity
    const globalFn = resolveIdentityFn(rawIdentity as Identity);
    getIdentity = (_path, item, idx) => globalFn(item, idx);
  }

  const ignoreRaw = opts.ignore ?? [];
  const ignore = new Set(ignoreRaw.filter((p) => !p.endsWith('/*')));
  const ignorePrefix = ignoreRaw.filter((p) => p.endsWith('/*')).map((p) => p.slice(0, -2));

  return {
    getIdentity,
    equal: opts.equal ?? deepEqual,
    detectMoves: opts.detectMoves !== false,
    maxDepth: opts.maxDepth ?? Infinity,
    ignore,
    ignorePrefix,
    cloneValues: opts.cloneValues !== false,
  };
}

/** Either a deep clone or the raw value, depending on `opts.cloneValues`. */
function maybeClone<T extends JsonValue>(val: T, opts: ResolvedOptions): T {
  return opts.cloneValues ? cloneDeep(val) : val;
}

// ── Path filtering ────────────────────────────

/**
 * Check whether `path` should be skipped during diffing.
 *
 * A path is ignored when it matches an entry in `opts.ignore` (exact) or
 * when it falls under any prefix listed in `opts.ignorePrefix` (the `/*`
 * syntax from {@link DiffOptions.ignore}).
 */
function shouldIgnore(path: string, opts: ResolvedOptions): boolean {
  if (opts.ignore.has(path)) return true;
  for (const prefix of opts.ignorePrefix) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

// ── Main diff entry point ─────────────────────

/**
 * Compute the structural diff between two JSON values.
 *
 * Returns a {@link DiffResult} containing an ordered list of operations that,
 * when applied via {@link patch}, transform `before` into `after`.
 *
 * @param before  - The source (original) JSON value.
 * @param after   - The target (modified) JSON value.
 * @param options - Optional {@link DiffOptions} to control identity resolution,
 *                  equality, move detection, recursion depth, path ignoring,
 *                  and value cloning.
 * @returns A {@link DiffResult} with operations, summary counters, and changed paths.
 *
 * @example
 * ```ts
 * import { diff } from '@websublime/delta';
 *
 * const before = { name: 'Alice', age: 30 };
 * const after  = { name: 'Bob',   age: 30, role: 'admin' };
 *
 * const result = diff(before, after);
 * // result.operations → [
 * //   { op: 'replace', path: '/name', value: 'Bob', oldValue: 'Alice' },
 * //   { op: 'add',     path: '/role', value: 'admin' }
 * // ]
 * // result.summary → { added: 1, removed: 0, replaced: 1, moved: 0, … }
 * ```
 *
 * @example Identity-based array diff
 * ```ts
 * const before = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
 * const after  = { items: [{ id: 2, v: 'b' }, { id: 1, v: 'a' }] };
 *
 * const result = diff(before, after, { arrayIdentity: 'id' });
 * // result.operations → [
 * //   { op: 'move', path: '/items', fromIndex: 0, toIndex: 1, … },
 * //   { op: 'move', path: '/items', fromIndex: 1, toIndex: 0, … }
 * // ]
 * ```
 */
export function diff(before: JsonValue, after: JsonValue, options?: DiffOptions): DiffResult {
  const opts = resolveOptions(options);
  const ops: DiffOp[] = [];

  diffValues(before, after, '', opts, 0, ops);

  return buildResult(ops);
}

/**
 * Aggregate a flat list of {@link DiffOp} into a {@link DiffResult}.
 *
 * Counts operations by type, builds the {@link DiffSummary}, collects all
 * touched paths into `changedPaths`, and detects `movedAndChanged` entries
 * by comparing `value` and `oldValue` on move operations.
 */
function buildResult(ops: DiffOp[]): DiffResult {
  const summary: DiffSummary = {
    added: 0,
    removed: 0,
    replaced: 0,
    moved: 0,
    movedAndChanged: 0,
    total: 0,
  };

  const changedPaths = new Set<string>();

  for (const op of ops) {
    summary.total++;
    changedPaths.add(op.path);

    switch (op.op) {
      case 'add':
        summary.added++;
        break;
      case 'remove':
        summary.removed++;
        break;
      case 'replace':
        summary.replaced++;
        break;
      case 'move':
        summary.moved++;
        if (!deepEqual(op.value, op.oldValue)) summary.movedAndChanged++;
        break;
    }
  }

  return {
    hasChanges: ops.length > 0,
    operations: ops,
    summary,
    changedPaths,
  };
}

// ── Recursive value diff ──────────────────────

/**
 * Recursively diff two JSON values and push resulting operations into `out`.
 *
 * Dispatches to {@link diffObjects}, {@link diffArrays}, or emits a `replace`
 * operation depending on the type pair. Respects `maxDepth` — at the limit,
 * sub-trees are compared as opaque blobs via `equal()`.
 *
 * @param before - Source value.
 * @param after  - Target value.
 * @param path   - Current RFC 6901 JSON Pointer path.
 * @param opts   - Resolved diff options.
 * @param depth  - Current recursion depth (0-based).
 * @param out    - Accumulator for emitted operations.
 */
function diffValues(
  before: JsonValue,
  after: JsonValue,
  path: string,
  opts: ResolvedOptions,
  depth: number,
  out: DiffOp[],
): void {
  if (shouldIgnore(path, opts)) return;
  if (opts.equal(before, after)) return;

  // At max depth, emit replace without recursing
  if (depth >= opts.maxDepth) {
    out.push({ op: 'replace', path, value: maybeClone(after, opts), oldValue: maybeClone(before, opts) });
    return;
  }

  const bIsObj = isObject(before);
  const aIsObj = isObject(after);
  const bIsArr = isArray(before);
  const aIsArr = isArray(after);

  if (bIsArr && aIsArr) {
    diffArrays(before as JsonValue[], after as JsonValue[], path, opts, depth, out);
    return;
  }

  if (bIsObj && aIsObj) {
    diffObjects(before as JsonObject, after as JsonObject, path, opts, depth, out);
    return;
  }

  // Type change or primitive change → replace
  out.push({ op: 'replace', path, value: maybeClone(after, opts), oldValue: maybeClone(before, opts) });
}

// ── Object diff ───────────────────────────────

/**
 * Diff two plain JSON objects by their keys.
 *
 * Treats `undefined` values as absent (JSON semantics). For each key present
 * in either side, emits `remove`, `add`, or recurses via {@link diffValues}
 * for keys present in both.
 */
function diffObjects(
  before: JsonObject,
  after: JsonObject,
  path: string,
  opts: ResolvedOptions,
  depth: number,
  out: DiffOp[],
): void {
  // Treat `undefined` values as absent keys (JSON semantics).
  const presentInBefore = (k: string): boolean =>
    Object.hasOwn(before, k) && before[k] !== undefined;
  const presentInAfter = (k: string): boolean => Object.hasOwn(after, k) && after[k] !== undefined;

  const allKeys = new Set<string>();
  for (const k of Object.keys(before)) if (presentInBefore(k)) allKeys.add(k);
  for (const k of Object.keys(after)) if (presentInAfter(k)) allKeys.add(k);

  for (const key of allKeys) {
    const childPath = joinPath(path, key);
    if (shouldIgnore(childPath, opts)) continue;

    const inBefore = presentInBefore(key);
    const inAfter = presentInAfter(key);

    if (inBefore && !inAfter) {
      out.push({ op: 'remove', path: childPath, oldValue: maybeClone(before[key], opts) });
    } else if (!inBefore && inAfter) {
      out.push({ op: 'add', path: childPath, value: maybeClone(after[key], opts) });
    } else {
      diffValues(before[key], after[key], childPath, opts, depth + 1, out);
    }
  }
}

// ── Array diff ────────────────────────────────

/**
 * Diff two JSON arrays, routing to the appropriate strategy.
 *
 * If an identity resolver is configured for this array path (checked by
 * probing the first available item), delegates to {@link diffArraysByIdentity}.
 * Otherwise falls back to the positional {@link diffArraysByLCS} algorithm.
 */
function diffArrays(
  before: JsonValue[],
  after: JsonValue[],
  path: string,
  opts: ResolvedOptions,
  depth: number,
  out: DiffOp[],
): void {
  // Check if identity is configured for this array path.
  const sampleItem = before[0] ?? after[0];
  const hasIdentity =
    sampleItem !== undefined ? opts.getIdentity(path, sampleItem, 0) !== null : false;

  if (hasIdentity) {
    diffArraysByIdentity(before, after, path, opts, depth, out);
  } else {
    diffArraysByLCS(before, after, path, opts, depth, out);
  }
}

// ── Identity-based array diff ─────────────────

/**
 * An entry in the identity map used by {@link diffArraysByIdentity}.
 *
 * The `key` is a composite string `"${rawId}:${occurrence}"` that uniquely
 * identifies each array item — even when duplicate raw identities exist.
 */
interface IdentityEntry {
  /** Composite key = `${rawId}:${occurrence}`. Deterministic for duplicates. */
  key: string;
  /** The array item value. */
  item: JsonValue;
  /** The item's position in the source or target array. */
  index: number;
}

/**
 * Build an identity map with occurrence-suffixed keys.
 *
 * Duplicate raw ids are disambiguated by their occurrence count, producing
 * keys like `1:0`, `1:1`, `1:2`. This guarantees:
 * - No silent data loss from `Map.set` overwrites
 * - Deterministic before↔after matching (first id-duplicate matches first, etc.)
 */
function buildIdentityMap(
  arr: JsonValue[],
  path: string,
  opts: ResolvedOptions,
): Map<string, IdentityEntry> {
  const map = new Map<string, IdentityEntry>();
  const counter = new Map<string | number, number>();
  for (let i = 0; i < arr.length; i++) {
    const raw = opts.getIdentity(path, arr[i], i) ?? `__pos_${i}`;
    const occ = counter.get(raw) ?? 0;
    counter.set(raw, occ + 1);
    const key = `${raw}:${occ}`;
    map.set(key, { key, item: arr[i], index: i });
  }
  return map;
}

/**
 * Diff two arrays using identity-based matching.
 *
 * Builds identity maps for both sides, then classifies items into three groups:
 * 1. **Removed** — present only in `before`.
 * 2. **Matched** — present in both. May have moved (`fromIndex !== toIndex`)
 *    and/or changed (values differ). Emits `move` or nested diff ops.
 * 3. **Added** — present only in `after`.
 *
 * When `detectMoves` is `false`, reorders are decomposed into remove + add
 * pairs instead of `move` operations.
 *
 * Emission order: removes (desc index) → moves (asc toIndex) → nested → adds (asc index).
 */
function diffArraysByIdentity(
  before: JsonValue[],
  after: JsonValue[],
  path: string,
  opts: ResolvedOptions,
  depth: number,
  out: DiffOp[],
): void {
  const beforeMap = buildIdentityMap(before, path, opts);
  const afterMap = buildIdentityMap(after, path, opts);

  const pendingRemoves: OpRemove[] = [];
  const pendingAdds: OpAdd[] = [];
  const pendingMoves: OpMove[] = [];
  const nestedOps: DiffOp[] = [];

  // ① Items present only in `before` → remove
  for (const [key, entry] of beforeMap) {
    if (!afterMap.has(key)) {
      pendingRemoves.push({
        op: 'remove',
        path: joinPath(path, entry.index),
        oldValue: maybeClone(entry.item, opts),
      });
    }
  }

  // ② Items in both → move / changed-in-place
  for (const [key, afterEntry] of afterMap) {
    const beforeEntry = beforeMap.get(key);
    if (!beforeEntry) continue;

    const moved = beforeEntry.index !== afterEntry.index;
    const changed = !opts.equal(beforeEntry.item, afterEntry.item);

    if (opts.detectMoves) {
      if (moved) {
        // Emit a single move op with full before/after snapshots.
        // We intentionally do NOT recurse into the item even when it also
        // changed — emitting nested ops at the destination index would
        // produce paths that reference different items during unpatch
        // (reverse reconstruction), corrupting the result.
        // Consumers can diff op.oldValue vs op.value for field-level detail.
        pendingMoves.push({
          op: 'move',
          path,
          fromIndex: beforeEntry.index,
          toIndex: afterEntry.index,
          value: maybeClone(afterEntry.item, opts),
          oldValue: maybeClone(beforeEntry.item, opts),
        });
      } else if (changed) {
        // Same position, value changed → recurse for granular ops
        diffValues(
          beforeEntry.item,
          afterEntry.item,
          joinPath(path, afterEntry.index),
          opts,
          depth + 1,
          nestedOps,
        );
      }
    } else {
      // detectMoves: false — treat moves as remove + add.
      if (moved) {
        pendingRemoves.push({
          op: 'remove',
          path: joinPath(path, beforeEntry.index),
          oldValue: maybeClone(beforeEntry.item, opts),
        });
        pendingAdds.push({
          op: 'add',
          path: joinPath(path, afterEntry.index),
          value: maybeClone(afterEntry.item, opts),
        });
      } else if (changed) {
        diffValues(
          beforeEntry.item,
          afterEntry.item,
          joinPath(path, afterEntry.index),
          opts,
          depth + 1,
          nestedOps,
        );
      }
    }
  }

  // ③ Items present only in `after` → add
  for (const [key, entry] of afterMap) {
    if (!beforeMap.has(key)) {
      pendingAdds.push({
        op: 'add',
        path: joinPath(path, entry.index),
        value: maybeClone(entry.item, opts),
      });
    }
  }

  // Ordering contract:
  //   removes: descending by before-index    (sweep-safe for sequential splice)
  //   moves:   ascending by toIndex          (deterministic; patch reconstructs)
  //   adds:    ascending by after-index      (sweep-safe for sequential splice)
  const indexOfLocal = (p: string): number => Number.parseInt(p.slice(path.length + 1), 10);
  pendingRemoves.sort((a, b) => indexOfLocal(b.path) - indexOfLocal(a.path));
  pendingAdds.sort((a, b) => indexOfLocal(a.path) - indexOfLocal(b.path));
  pendingMoves.sort((a, b) => a.toIndex - b.toIndex);

  out.push(...pendingRemoves);
  out.push(...pendingMoves);
  out.push(...nestedOps);
  out.push(...pendingAdds);
}

// ── LCS-based (positional) array diff ─────────

/**
 * Diff two arrays using the Longest Common Subsequence (LCS) algorithm.
 *
 * Used when no identity resolver is configured for the array path. Items
 * are matched purely by position and equality. Does not emit `move` ops —
 * reorders appear as a combination of removes and adds.
 *
 * Emission order: removes (desc index) → nested diffs on kept items → adds (asc index).
 */
function diffArraysByLCS(
  before: JsonValue[],
  after: JsonValue[],
  path: string,
  opts: ResolvedOptions,
  depth: number,
  out: DiffOp[],
): void {
  const { removed, added, kept } = lcsArrayDiff(before, after, opts.equal);

  // Removes (descending index in `before`)
  const sortedRemoved = [...removed].sort((a, b) => b - a);
  for (const i of sortedRemoved) {
    out.push({ op: 'remove', path: joinPath(path, i), oldValue: maybeClone(before[i], opts) });
  }

  // Recurse into kept (matched) items that still differ under custom `equal`
  for (const { aIndex, bIndex } of kept) {
    if (!opts.equal(before[aIndex], after[bIndex])) {
      diffValues(before[aIndex], after[bIndex], joinPath(path, bIndex), opts, depth + 1, out);
    }
  }

  // Adds (ascending index in `after`)
  const sortedAdded = [...added].sort((a, b) => a - b);
  for (const i of sortedAdded) {
    out.push({ op: 'add', path: joinPath(path, i), value: maybeClone(after[i], opts) });
  }
}
