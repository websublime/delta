// ─────────────────────────────────────────────
//  delta:// — RFC 6902 JSON Patch adapter
//  Export a DiffResult as standard JSON Patch
// ─────────────────────────────────────────────

import type { DiffResult, JsonValue } from './types.js';
import { joinPath } from './utils.js';

// ── RFC 6902 types ────────────────────────────

/** RFC 6902 `add` operation — inserts `value` at `path`. */
export interface RFC6902Add {
  op: 'add';
  path: string;
  value: JsonValue;
}
/** RFC 6902 `remove` operation — deletes the value at `path`. */
export interface RFC6902Remove {
  op: 'remove';
  path: string;
}
/** RFC 6902 `replace` operation — replaces the value at `path` with `value`. */
export interface RFC6902Replace {
  op: 'replace';
  path: string;
  value: JsonValue;
}
/** RFC 6902 `move` operation — moves the value from `from` to `path`. */
export interface RFC6902Move {
  op: 'move';
  from: string;
  path: string;
}
/** RFC 6902 `copy` operation — copies the value from `from` to `path`. */
export interface RFC6902Copy {
  op: 'copy';
  from: string;
  path: string;
}
/** RFC 6902 `test` operation — asserts the value at `path` equals `value`. */
export interface RFC6902Test {
  op: 'test';
  path: string;
  value: JsonValue;
}

/** Discriminated union of all RFC 6902 operation types. */
export type RFC6902Op =
  | RFC6902Add
  | RFC6902Remove
  | RFC6902Replace
  | RFC6902Move
  | RFC6902Copy
  | RFC6902Test;

/** An ordered list of RFC 6902 operations forming a complete JSON Patch document. */
export type RFC6902Patch = RFC6902Op[];

// ── Conversion ────────────────────────────────

/**
 * Convert a delta `DiffResult` to a standard RFC 6902 JSON Patch array.
 *
 * Notes:
 * - `remove` ops lose `oldValue` (not part of RFC 6902)
 * - `replace` ops lose `oldValue`
 * - Delta `move` ops are decomposed into RFC 6902 `remove` + `add` pairs.
 *   Delta moves use parallel reconstruction semantics (fromIndex/toIndex
 *   reference the original and final arrays simultaneously), while RFC 6902
 *   operations are applied strictly sequentially. Emitting RFC 6902 `move`
 *   would produce incorrect results when multiple moves target the same array.
 */
export function toRFC6902(result: DiffResult): RFC6902Patch {
  const removes: RFC6902Remove[] = [];
  const adds: RFC6902Add[] = [];
  const replaces: RFC6902Replace[] = [];

  for (const op of result.operations) {
    switch (op.op) {
      case 'add':
        adds.push({ op: 'add', path: op.path, value: op.value });
        break;
      case 'remove':
        removes.push({ op: 'remove', path: op.path });
        break;
      case 'replace':
        replaces.push({ op: 'replace', path: op.path, value: op.value });
        break;
      case 'move': {
        // Decompose into remove (at original index) + add (at final index).
        removes.push({ op: 'remove', path: joinPath(op.path, op.fromIndex) });
        adds.push({ op: 'add', path: joinPath(op.path, op.toIndex), value: op.value });
        break;
      }
    }
  }

  // For correct sequential application per RFC 6902:
  // - Array removes must be applied in descending index order (higher indices
  //   first so earlier indices are not shifted).
  // - Array adds must be applied in ascending index order.
  // Non-numeric path segments (object keys) are unaffected by ordering.
  const lastSegmentIndex = (path: string): number => {
    const parts = path.split('/');
    return Number.parseInt(parts[parts.length - 1], 10);
  };

  removes.sort((a, b) => {
    const iA = lastSegmentIndex(a.path);
    const iB = lastSegmentIndex(b.path);
    if (Number.isNaN(iA) || Number.isNaN(iB)) return 0;
    return iB - iA;
  });

  adds.sort((a, b) => {
    const iA = lastSegmentIndex(a.path);
    const iB = lastSegmentIndex(b.path);
    if (Number.isNaN(iA) || Number.isNaN(iB)) return 0;
    return iA - iB;
  });

  // Order: removes → adds → replaces.
  // Replaces target positions in the final array state, so they must come
  // after the array has been fully reconstructed by removes and adds.
  return [...removes, ...adds, ...replaces];
}

/**
 * Serialize to a formatted JSON string.
 */
export function toRFC6902JSON(result: DiffResult, indent = 2): string {
  return JSON.stringify(toRFC6902(result), null, indent);
}
