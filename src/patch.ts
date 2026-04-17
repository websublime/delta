// ─────────────────────────────────────────────
//  delta:// — patch & unpatch
//  Array moves use RECONSTRUCTION not sequential
//  application, to avoid index-shift errors.
// ─────────────────────────────────────────────

import { DeltaError } from './errors.js';
import type {
  DiffOp,
  DiffResult,
  JsonObject,
  JsonValue,
  OpAdd,
  OpMove,
  OpRemove,
  OpReplace,
} from './types.js';
import { cloneDeep, isArray, isObject, safeSet, splitPath } from './utils.js';

// ── Runtime validation ────────────────────────

/**
 * Validate that `result` is a well-formed `DiffResult`. This is a runtime guard
 * for untrusted inputs (e.g. deserialized from the wire). It does NOT attempt
 * to validate values — only structure.
 */
function validateDiffResult(result: unknown): asserts result is DiffResult {
  if (!isObject(result as JsonValue)) {
    throw new DeltaError('INVALID_DIFF_RESULT', 'DiffResult must be an object');
  }
  const r = result as { operations?: unknown };
  if (!Array.isArray(r.operations)) {
    throw new DeltaError('INVALID_DIFF_RESULT', 'DiffResult.operations must be an array');
  }
  for (let i = 0; i < r.operations.length; i++) {
    validateOp(r.operations[i], i);
  }
}

/**
 * Validate that a single operation object is well-formed.
 *
 * Checks for the presence of required fields based on `op.op`:
 * - `add` → `value`
 * - `remove` → `oldValue`
 * - `replace` → `value` + `oldValue`
 * - `move` → `fromIndex` + `toIndex` + `value` + `oldValue`
 *
 * @throws {@link DeltaError} with code `INVALID_OPERATION` on any structural issue.
 */
function validateOp(op: unknown, index: number): asserts op is DiffOp {
  if (!isObject(op as JsonValue)) {
    throw new DeltaError('INVALID_OPERATION', `operations[${index}] must be an object`);
  }
  const o = op as Record<string, unknown>;
  if (typeof o.path !== 'string') {
    throw new DeltaError('INVALID_OPERATION', `operations[${index}].path must be a string`);
  }
  switch (o.op) {
    case 'add':
      if (!('value' in o)) {
        throw new DeltaError('INVALID_OPERATION', `add op at ${index} missing 'value'`, o.path);
      }
      return;
    case 'remove':
      if (!('oldValue' in o)) {
        throw new DeltaError(
          'INVALID_OPERATION',
          `remove op at ${index} missing 'oldValue'`,
          o.path,
        );
      }
      return;
    case 'replace':
      if (!('value' in o) || !('oldValue' in o)) {
        throw new DeltaError(
          'INVALID_OPERATION',
          `replace op at ${index} missing 'value' or 'oldValue'`,
          o.path,
        );
      }
      return;
    case 'move':
      if (typeof o.fromIndex !== 'number' || typeof o.toIndex !== 'number') {
        throw new DeltaError(
          'INVALID_OPERATION',
          `move op at ${index} missing 'fromIndex'/'toIndex'`,
          o.path,
        );
      }
      if (!('value' in o) || !('oldValue' in o)) {
        throw new DeltaError(
          'INVALID_OPERATION',
          `move op at ${index} missing 'value' or 'oldValue'`,
          o.path,
        );
      }
      return;
    default:
      throw new DeltaError('INVALID_OPERATION', `unknown op '${String(o.op)}' at ${index}`);
  }
}

// ── Internal helpers ──────────────────────────

/**
 * Navigate to the parent container and last key of a given JSON Pointer path.
 *
 * @param root - The document root.
 * @param path - An RFC 6901 JSON Pointer (must have at least one segment).
 * @returns An object with `parent` (the container) and `key` (the last segment).
 * @throws {@link DeltaError} with code `INVALID_OPERATION` for root paths,
 *         or `PATH_NOT_FOUND` when an intermediate node is not an object/array.
 */
function getParent(root: JsonValue, path: string): { parent: JsonValue; key: string } {
  const segs = splitPath(path);
  if (segs.length === 0) {
    throw new DeltaError('INVALID_OPERATION', 'cannot resolve parent of root path', path);
  }
  let cur: JsonValue = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') {
      throw new DeltaError('PATH_NOT_FOUND', `intermediate node is not an object`, path);
    }
    cur = (cur as Record<string, JsonValue>)[segs[i]];
  }
  return { parent: cur, key: segs[segs.length - 1] };
}

/**
 * Apply an `add` operation on the document.
 *
 * For array parents, inserts at the numeric index (or appends when the key
 * is `'-'`). For object parents, sets the key via {@link safeSet}.
 * The value is deep-cloned before insertion.
 *
 * @throws {@link DeltaError} on invalid index or non-container parent.
 */
function applyAdd(root: JsonValue, path: string, value: JsonValue): void {
  const { parent, key } = getParent(root, path);
  if (isArray(parent)) {
    const idx = key === '-' ? parent.length : Number.parseInt(key, 10);
    if (Number.isNaN(idx)) {
      throw new DeltaError('INVALID_OPERATION', `array add requires numeric index, got '${key}'`, path);
    }
    parent.splice(idx, 0, cloneDeep(value));
  } else if (isObject(parent)) {
    safeSet(parent as JsonObject, key, cloneDeep(value));
  } else {
    throw new DeltaError('PATH_NOT_FOUND', 'parent is not an object or array', path);
  }
}

/**
 * Apply a `remove` operation on the document.
 *
 * For array parents, splices out the element at the numeric index.
 * For object parents, deletes the key.
 *
 * @throws {@link DeltaError} on invalid index or non-container parent.
 */
function applyRemove(root: JsonValue, path: string): void {
  const { parent, key } = getParent(root, path);
  if (isArray(parent)) {
    const idx = Number.parseInt(key, 10);
    if (Number.isNaN(idx)) {
      throw new DeltaError('INVALID_OPERATION', `array remove requires numeric index, got '${key}'`, path);
    }
    parent.splice(idx, 1);
  } else if (isObject(parent)) {
    delete (parent as JsonObject)[key];
  } else {
    throw new DeltaError('PATH_NOT_FOUND', 'parent is not an object or array', path);
  }
}

/**
 * Apply a `replace` operation on the document.
 *
 * Overwrites the value at `path` with a deep clone of `value`.
 *
 * @throws {@link DeltaError} on invalid index or non-container parent.
 */
function applyReplace(root: JsonValue, path: string, value: JsonValue): void {
  const { parent, key } = getParent(root, path);
  if (isArray(parent)) {
    const idx = Number.parseInt(key, 10);
    if (Number.isNaN(idx)) {
      throw new DeltaError('INVALID_OPERATION', `array replace requires numeric index, got '${key}'`, path);
    }
    parent[idx] = cloneDeep(value);
  } else if (isObject(parent)) {
    safeSet(parent as JsonObject, key, cloneDeep(value));
  } else {
    throw new DeltaError('PATH_NOT_FOUND', 'parent is not an object or array', path);
  }
}

/**
 * Resolve a JSON Pointer path to the value it references in the document.
 *
 * Returns the root when `path` is `''`. Throws when an intermediate
 * segment points to a non-container (null or primitive).
 *
 * @param root - The document root.
 * @param path - An RFC 6901 JSON Pointer.
 * @returns The referenced value.
 * @throws {@link DeltaError} with code `PATH_NOT_FOUND`.
 */
function getNodeRef(root: JsonValue, path: string): JsonValue {
  if (path === '') return root;
  const segs = splitPath(path);
  let cur: JsonValue = root;
  for (const seg of segs) {
    if (cur === null || typeof cur !== 'object') {
      throw new DeltaError('PATH_NOT_FOUND', `intermediate node is not an object`, path);
    }
    cur = (cur as Record<string, JsonValue>)[seg];
  }
  return cur;
}

/**
 * Resolve a JSON Pointer path and return the value only if it is an array.
 *
 * @returns The array at `path`, or `null` when the value is not an array.
 */
function getArrayRef(root: JsonValue, path: string): JsonValue[] | null {
  const node = getNodeRef(root, path);
  return isArray(node) ? node : null;
}

/**
 * Replace the value at `path` in the document with `value`.
 *
 * Navigates to the parent container and sets the last segment key.
 * Used internally to swap out reconstructed arrays after move operations.
 */
function setNodeRef(root: JsonValue, path: string, value: JsonValue[]): void {
  const { parent, key } = getParent(root, path);
  if (isArray(parent)) {
    const idx = Number.parseInt(key, 10);
    parent[idx] = value;
  } else if (isObject(parent)) {
    safeSet(parent as JsonObject, key, value);
  }
}

// ── Array reconstruction ──────────────────────

/**
 * Reconstruct the AFTER array from the BEFORE array + move/add/remove ops.
 * Avoids sequential splice which breaks when multiple moves share an array.
 *
 * Algorithm:
 * 1. Collect originalIndices that were removed or moved-away.
 * 2. keptItems = before items not in either set, in original order.
 * 3. Allocate result[afterLen].
 *    - Place moved items at toIndex (op.value = final value).
 *    - Place added items at finalIndex (op.value).
 * 4. Fill remaining slots with keptItems in order.
 */
function reconstructArrayForward(
  beforeArr: JsonValue[],
  moves: OpMove[],
  adds: OpAdd[],
  removes: OpRemove[],
): JsonValue[] {
  const removedOriginalIndices = new Set<number>();
  for (const op of removes) {
    const segs = splitPath(op.path);
    removedOriginalIndices.add(Number.parseInt(segs[segs.length - 1], 10));
  }

  const movedFromIndices = new Set<number>();
  for (const op of moves) {
    movedFromIndices.add(op.fromIndex);
  }

  const keptItems: JsonValue[] = [];
  for (let i = 0; i < beforeArr.length; i++) {
    if (!removedOriginalIndices.has(i) && !movedFromIndices.has(i)) {
      keptItems.push(cloneDeep(beforeArr[i]));
    }
  }

  const afterLen = beforeArr.length - removedOriginalIndices.size + adds.length;
  const result: (JsonValue | undefined)[] = new Array(afterLen).fill(undefined);

  for (const op of moves) {
    result[op.toIndex] = cloneDeep(op.value);
  }
  for (const op of adds) {
    const segs = splitPath(op.path);
    const idx = Number.parseInt(segs[segs.length - 1], 10);
    result[idx] = cloneDeep(op.value);
  }

  let ki = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      result[i] = keptItems[ki++];
    }
  }

  return result as JsonValue[];
}

/**
 * Reconstruct the BEFORE array from the AFTER array + move/add/remove ops.
 * Inverse of reconstructArrayForward.
 */
function reconstructArrayReverse(
  afterArr: JsonValue[],
  moves: OpMove[],
  adds: OpAdd[],
  removes: OpRemove[],
): JsonValue[] {
  const addedFinalIndices = new Set<number>();
  for (const op of adds) {
    const segs = splitPath(op.path);
    addedFinalIndices.add(Number.parseInt(segs[segs.length - 1], 10));
  }

  const movedToIndices = new Set<number>();
  for (const op of moves) {
    movedToIndices.add(op.toIndex);
  }

  const keptItems: JsonValue[] = [];
  for (let i = 0; i < afterArr.length; i++) {
    if (!addedFinalIndices.has(i) && !movedToIndices.has(i)) {
      keptItems.push(cloneDeep(afterArr[i]));
    }
  }

  const beforeLen = afterArr.length - adds.length + removes.length;
  const result: (JsonValue | undefined)[] = new Array(beforeLen).fill(undefined);

  for (const op of moves) {
    result[op.fromIndex] = cloneDeep(op.oldValue);
  }
  for (const op of removes) {
    const segs = splitPath(op.path);
    const idx = Number.parseInt(segs[segs.length - 1], 10);
    result[idx] = cloneDeep(op.oldValue);
  }

  let ki = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      result[i] = keptItems[ki++];
    }
  }

  return result as JsonValue[];
}

// ── Group ops by array path ───────────────────

/**
 * A group of operations that all target the same array path.
 *
 * Used by {@link groupArrayOps} to batch operations for array
 * reconstruction instead of sequential splice application.
 */
interface ArrayOpGroup {
  /** Move operations within this array. */
  moves: OpMove[];
  /** Add operations targeting child positions of this array. */
  adds: OpAdd[];
  /** Remove operations targeting child positions of this array. */
  removes: OpRemove[];
  /** Replace operations targeting child positions of this array. */
  replaces: OpReplace[];
}

/**
 * Extract the parent path from a JSON Pointer.
 *
 * @returns The parent path, `''` for root-level paths, or `null` for the
 *          root pointer itself.
 */
function parentOf(path: string): string | null {
  const segs = splitPath(path);
  if (segs.length === 0) return null;
  if (segs.length === 1) return '';
  return `/${segs.slice(0, -1).join('/')}`;
}

/**
 * Group operations by the array path they belong to.
 *
 * Only arrays that contain at least one `move` operation are grouped.
 * For each such array, all child add/remove/replace operations (whose
 * parent path matches the array) are collected into the same
 * {@link ArrayOpGroup}.
 *
 * @returns A map from array path to its grouped operations.
 */
function groupArrayOps(operations: DiffOp[]): Map<string, ArrayOpGroup> {
  const arrayPathsWithMoves = new Set<string>();
  for (const op of operations) {
    if (op.op === 'move') arrayPathsWithMoves.add(op.path);
  }

  const map = new Map<string, ArrayOpGroup>();

  for (const arrPath of arrayPathsWithMoves) {
    const group: ArrayOpGroup = { moves: [], adds: [], removes: [], replaces: [] };

    for (const op of operations) {
      if (op.op === 'move' && op.path === arrPath) {
        group.moves.push(op);
        continue;
      }
      const parent = parentOf(op.path);
      if (parent !== arrPath) continue;

      if (op.op === 'add') group.adds.push(op);
      else if (op.op === 'remove') group.removes.push(op);
      else if (op.op === 'replace') group.replaces.push(op);
    }

    map.set(arrPath, group);
  }

  return map;
}

// ── Forward patch ─────────────────────────────

/**
 * Apply a `DiffResult` to `before`, producing `after`.
 * The original `before` is never mutated.
 *
 * Arrays containing move ops are reconstructed directly (not via
 * sequential splice) to avoid index-shift errors with multiple moves.
 *
 * @throws DeltaError if `result` is not a well-formed DiffResult.
 */
export function patch(before: JsonValue, result: DiffResult): JsonValue {
  validateDiffResult(result);

  // Root replacement (path === '') short-circuits everything.
  const rootReplace = result.operations.find(
    (op): op is OpReplace => op.op === 'replace' && op.path === '',
  );
  if (rootReplace) return cloneDeep(rootReplace.value);

  const doc = cloneDeep(before);

  const arrayGroups = groupArrayOps(result.operations);
  const handledPaths = new Set<string>();

  for (const [arrPath, group] of arrayGroups) {
    for (const op of [...group.moves, ...group.adds, ...group.removes, ...group.replaces]) {
      handledPaths.add(op.path);
    }
    const arrRef = getArrayRef(doc, arrPath);
    if (!arrRef) continue;
    const newArr = reconstructArrayForward(arrRef, group.moves, group.adds, group.removes);
    if (arrPath === '') {
      arrRef.splice(0, arrRef.length, ...newArr);
    } else {
      setNodeRef(doc, arrPath, newArr);
    }
    // Replaces on positions that weren't moved — apply on final positions.
    for (const op of group.replaces) {
      applyReplace(doc, op.path, op.value);
    }
  }

  // Remaining ops — the emission contract (removes desc, adds asc) is preserved
  // because we iterate in insertion order within each sweep.
  for (const op of result.operations) {
    if (handledPaths.has(op.path)) continue;
    if (op.op === 'remove') applyRemove(doc, op.path);
  }
  for (const op of result.operations) {
    if (handledPaths.has(op.path)) continue;
    if (op.op === 'add') applyAdd(doc, op.path, op.value);
  }
  for (const op of result.operations) {
    if (handledPaths.has(op.path)) continue;
    if (op.op === 'replace') applyReplace(doc, op.path, op.value);
  }

  return doc;
}

// ── Reverse patch (unpatch) ───────────────────

/**
 * Undo a `DiffResult` applied to `after`, recovering `before`.
 * The original `after` is never mutated.
 *
 * All destructive operations carry `oldValue`, so recovery is possible
 * without the original document.
 *
 * @throws DeltaError if `result` is not a well-formed DiffResult.
 */
export function unpatch(after: JsonValue, result: DiffResult): JsonValue {
  validateDiffResult(result);

  const rootReplace = result.operations.find(
    (op): op is OpReplace => op.op === 'replace' && op.path === '',
  );
  if (rootReplace) return cloneDeep(rootReplace.oldValue);

  const doc = cloneDeep(after);

  const arrayGroups = groupArrayOps(result.operations);
  const handledPaths = new Set<string>();

  for (const [arrPath, group] of arrayGroups) {
    for (const op of [...group.moves, ...group.adds, ...group.removes, ...group.replaces]) {
      handledPaths.add(op.path);
    }
    // Undo replaces first (while array still reflects after-state)
    for (const op of group.replaces) {
      applyReplace(doc, op.path, op.oldValue);
    }
    const arrRef = getArrayRef(doc, arrPath);
    if (!arrRef) continue;
    const newArr = reconstructArrayReverse(arrRef, group.moves, group.adds, group.removes);
    if (arrPath === '') {
      arrRef.splice(0, arrRef.length, ...newArr);
    } else {
      setNodeRef(doc, arrPath, newArr);
    }
  }

  for (const op of result.operations) {
    if (handledPaths.has(op.path)) continue;
    if (op.op === 'replace') applyReplace(doc, op.path, op.oldValue);
  }

  // Undo adds (descending index to avoid shifting)
  const lastSegIndex = (p: string): number => {
    const segs = splitPath(p);
    return Number.parseInt(segs[segs.length - 1], 10);
  };
  const undoAdds = result.operations
    .filter((op): op is OpAdd => op.op === 'add' && !handledPaths.has(op.path))
    .sort((a, b) => {
      const iA = lastSegIndex(a.path);
      const iB = lastSegIndex(b.path);
      return Number.isNaN(iA) || Number.isNaN(iB) ? 0 : iB - iA;
    });
  for (const op of undoAdds) applyRemove(doc, op.path);

  // Undo removes (ascending index)
  const undoRemoves = result.operations
    .filter((op): op is OpRemove => op.op === 'remove' && !handledPaths.has(op.path))
    .sort((a, b) => {
      const iA = lastSegIndex(a.path);
      const iB = lastSegIndex(b.path);
      return Number.isNaN(iA) || Number.isNaN(iB) ? 0 : iA - iB;
    });
  for (const op of undoRemoves) applyAdd(doc, op.path, op.oldValue);

  return doc;
}
