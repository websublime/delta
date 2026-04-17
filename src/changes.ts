// ─────────────────────────────────────────────
//  delta:// — sparse change extraction
//  Build a minimal object containing only what changed
// ─────────────────────────────────────────────

import { diff } from './diff.js';
import type {
  ChangesResult,
  DiffOptions,
  DiffResult,
  JsonObject,
  JsonValue,
  OpReplace,
} from './types.js';
import { isObject, splitPath } from './utils.js';

// ── Public API ───────────────────────────────

/**
 * Compute a sparse representation of the changes between two JSON values.
 *
 * Internally calls {@link diff} and then projects the result into a
 * {@link ChangesResult} with:
 * - `updated` — a sparse object holding only added, replaced, and moved values
 *   (preserves nested structure).
 * - `removed` — an array of RFC 6901 paths that were deleted.
 * - `diff` — the full {@link DiffResult} for low-level access.
 *
 * @param before  - The source (original) JSON value.
 * @param after   - The target (modified) JSON value.
 * @param options - Optional {@link DiffOptions} forwarded to {@link diff}.
 * @returns A {@link ChangesResult} describing what changed.
 *
 * @example Simple object changes
 * ```ts
 * import { changes } from '@websublime/delta';
 *
 * const before = { name: 'Alice', age: 30, email: 'alice@example.com' };
 * const after  = { name: 'Bob',   age: 30, role: 'admin' };
 *
 * const result = changes(before, after);
 * result.updated  // → { name: 'Bob', role: 'admin' }
 * result.removed  // → ['/email']
 * ```
 *
 * @example Nested changes
 * ```ts
 * const before = { user: { name: 'Alice', settings: { theme: 'dark', lang: 'en' } } };
 * const after  = { user: { name: 'Alice', settings: { theme: 'light', lang: 'en' } } };
 *
 * const result = changes(before, after);
 * result.updated  // → { user: { settings: { theme: 'light' } } }
 * result.removed  // → []
 * ```
 *
 * @example Array with identity-based diff
 * ```ts
 * const before = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
 * const after  = { items: [{ id: 2, v: 'b' }, { id: 1, v: 'x' }] };
 *
 * const result = changes(before, after, { arrayIdentity: 'id' });
 * // result.updated includes moved items at their new positions
 * ```
 */
export function changes(
  before: JsonValue,
  after: JsonValue,
  options?: DiffOptions,
): ChangesResult {
  const result = diff(before, after, options);
  return changesFromDiff(result);
}

/**
 * Extract a sparse changes representation from an existing {@link DiffResult}.
 *
 * Useful when the diff has already been computed and you want the sparse
 * changes object without re-diffing.
 *
 * @param result - A previously computed {@link DiffResult}.
 * @returns A {@link ChangesResult} derived from the operations in `result`.
 *
 * @example
 * ```ts
 * import { diff, changesFromDiff } from '@websublime/delta';
 *
 * const result = diff(before, after, options);
 * // ... inspect result.operations ...
 *
 * const sparse = changesFromDiff(result);
 * sparse.updated // only the values that were set
 * sparse.removed // only the paths that were deleted
 * ```
 */
export function changesFromDiff(result: DiffResult): ChangesResult {
  if (!result.hasChanges) {
    return { hasChanges: false, updated: null, removed: [], diff: result };
  }

  // Root-level replace short-circuits — the entire document changed.
  const rootReplace = result.operations.find(
    (op): op is OpReplace => op.op === 'replace' && op.path === '',
  );
  if (rootReplace) {
    return { hasChanges: true, updated: rootReplace.value, removed: [], diff: result };
  }

  const removed: string[] = [];
  const entries: SparseEntry[] = [];

  for (const op of result.operations) {
    switch (op.op) {
      case 'add':
        entries.push({ segments: splitPath(op.path), value: op.value });
        break;
      case 'replace':
        entries.push({ segments: splitPath(op.path), value: op.value });
        break;
      case 'remove':
        removed.push(op.path);
        break;
      case 'move':
        // Include the value at its destination index.
        entries.push({
          segments: [...splitPath(op.path), String(op.toIndex)],
          value: op.value,
        });
        break;
    }
  }

  const updated = buildSparseObject(entries);
  const hasUpdatedKeys = Object.keys(updated).length > 0;

  return {
    hasChanges: true,
    updated: hasUpdatedKeys ? updated : null,
    removed,
    diff: result,
  };
}

// ── Internal helpers ─────────────────────────

/**
 * A path/value pair used to construct the sparse output object.
 * `segments` is the already-split (unescaped) JSON Pointer path.
 */
interface SparseEntry {
  /** Unescaped path segments (output of {@link splitPath}). */
  segments: string[];
  /** The value to place at this path. */
  value: JsonValue;
}

/**
 * Build a sparse nested object from a list of path/value entries.
 *
 * Intermediate containers are always plain objects — even when the path
 * segment is numeric (array indices become string keys). This keeps the
 * output JSON-serialisable and avoids sparse `Array` holes.
 *
 * @param entries - Path/value pairs to insert into the sparse tree.
 * @returns A {@link JsonObject} containing only the provided paths.
 */
function buildSparseObject(entries: SparseEntry[]): JsonObject {
  const root: JsonObject = {};

  for (const { segments, value } of entries) {
    if (segments.length === 0) continue;

    let current: JsonObject = root;

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (!isObject(current[seg] as JsonValue)) {
        current[seg] = {} as JsonObject;
      }
      current = current[seg] as JsonObject;
    }

    current[segments[segments.length - 1]] = value;
  }

  return root;
}
