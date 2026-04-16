// ─────────────────────────────────────────────
//  delta:// — RFC 6902 JSON Patch adapter
//  Export a DiffResult as standard JSON Patch
// ─────────────────────────────────────────────

import type { DiffResult, JsonValue } from './types.js';
import { joinPath } from './utils.js';

// ── RFC 6902 types ────────────────────────────

export interface RFC6902Add {
  op: 'add';
  path: string;
  value: JsonValue;
}
export interface RFC6902Remove {
  op: 'remove';
  path: string;
}
export interface RFC6902Replace {
  op: 'replace';
  path: string;
  value: JsonValue;
}
export interface RFC6902Move {
  op: 'move';
  from: string;
  path: string;
}
export interface RFC6902Copy {
  op: 'copy';
  from: string;
  path: string;
}
export interface RFC6902Test {
  op: 'test';
  path: string;
  value: JsonValue;
}

export type RFC6902Op =
  | RFC6902Add
  | RFC6902Remove
  | RFC6902Replace
  | RFC6902Move
  | RFC6902Copy
  | RFC6902Test;

export type RFC6902Patch = RFC6902Op[];

// ── Conversion ────────────────────────────────

/**
 * Convert a delta `DiffResult` to a standard RFC 6902 JSON Patch array.
 *
 * Notes:
 * - `remove` ops lose `oldValue` (not part of RFC 6902)
 * - `replace` ops lose `oldValue`
 * - `move` ops are converted to RFC 6902 `move` with from/path as full paths
 */
export function toRFC6902(result: DiffResult): RFC6902Patch {
  const patch: RFC6902Patch = [];

  for (const op of result.operations) {
    switch (op.op) {
      case 'add':
        patch.push({ op: 'add', path: op.path, value: op.value });
        break;
      case 'remove':
        patch.push({ op: 'remove', path: op.path });
        break;
      case 'replace':
        patch.push({ op: 'replace', path: op.path, value: op.value });
        break;
      case 'move': {
        // Convert delta move (array-path + indices) to RFC 6902 move (full paths)
        const fromPath = joinPath(op.path, op.fromIndex);
        const toPath = joinPath(op.path, op.toIndex);
        patch.push({ op: 'move', from: fromPath, path: toPath });
        break;
      }
    }
  }

  return patch;
}

/**
 * Serialize to a formatted JSON string.
 */
export function toRFC6902JSON(result: DiffResult, indent = 2): string {
  return JSON.stringify(toRFC6902(result), null, indent);
}
