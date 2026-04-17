// ─────────────────────────────────────────────
//  delta:// — sparse change extraction
//  Build a minimal object containing only what changed
// ─────────────────────────────────────────────

import type {
  DiffResult,
  JsonObject,
  JsonValue,
  OpReplace,
} from './types.js';
import { isObject, splitPath } from './utils.js';

// ── Public API ───────────────────────────────

/**
 * Extract a sparse object from a {@link DiffResult} containing only the
 * values that changed. Removed keys appear as `null`.
 *
 * Returns `null` when no changes exist.
 *
 * @param result - A previously computed {@link DiffResult}.
 * @returns A sparse {@link JsonValue} with only changed fields, or `null`.
 *
 * @example Object changes
 * ```ts
 * const r = diff(
 *   { id: 1, message: 'hello', status: 'pending' },
 *   { id: 1, message: 'hello', status: 'approved' },
 * );
 * snapshot(r)  // → { status: 'approved' }
 * ```
 *
 * @example Nested changes (sparse)
 * ```ts
 * const r = diff(
 *   { user: { name: 'Alice', settings: { theme: 'dark', lang: 'en' } } },
 *   { user: { name: 'Alice', settings: { theme: 'light', lang: 'en' } } },
 * );
 * snapshot(r)  // → { user: { settings: { theme: 'light' } } }
 * ```
 *
 * @example Removals appear as null
 * ```ts
 * snapshot(diff({ a: 1, b: 2 }, { a: 1 }))  // → { b: null }
 * ```
 *
 * @example Root replacement
 * ```ts
 * snapshot(diff(1, 2))            // → 2
 * snapshot(diff('a', { x: 1 }))   // → { x: 1 }
 * ```
 */
export function snapshot(result: DiffResult): JsonValue | null {
  if (!result.hasChanges) return null;

  // Root-level replace — the entire value changed.
  const rootReplace = result.operations.find(
    (op): op is OpReplace => op.op === 'replace' && op.path === '',
  );
  if (rootReplace) return rootReplace.value;

  const root: JsonObject = {};

  for (const op of result.operations) {
    switch (op.op) {
      case 'add':
        setAtPath(root, splitPath(op.path), op.value);
        break;
      case 'replace':
        setAtPath(root, splitPath(op.path), op.value);
        break;
      case 'remove':
        setAtPath(root, splitPath(op.path), null);
        break;
      case 'move':
        // Place the value at the destination index within the array path.
        setAtPath(root, [...splitPath(op.path), String(op.toIndex)], op.value);
        break;
    }
  }

  return Object.keys(root).length > 0 ? root : null;
}

// ── Internal helpers ─────────────────────────

/**
 * Set a value at a path within a sparse object tree.
 *
 * Intermediate containers are always plain objects — even when the path
 * segment is numeric (array indices become string keys). This keeps the
 * output JSON-serialisable and avoids sparse `Array` holes.
 */
function setAtPath(root: JsonObject, segments: string[], value: JsonValue): void {
  if (segments.length === 0) return;

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
