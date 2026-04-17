// ─────────────────────────────────────────────
//  delta:// — utilities
// ─────────────────────────────────────────────

import { DeltaError } from './errors.js';
import type { JsonObject, JsonValue } from './types.js';

// ── Type guards ───────────────────────────────

/**
 * Check whether `val` is a plain JSON object (non-null, non-array object).
 *
 * @param val - The value to test.
 * @returns `true` when `val` is a {@link JsonObject}.
 */
export function isObject(val: unknown): val is JsonObject {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Check whether `val` is an array of {@link JsonValue}.
 *
 * @param val - The value to test.
 * @returns `true` when `val` is an array.
 */
export function isArray(val: unknown): val is JsonValue[] {
  return Array.isArray(val);
}

// ── Deep equality ─────────────────────────────

/**
 * Structural equality for JSON values.
 *
 * Semantics:
 * - `NaN` is considered equal to `NaN` (diverges from `===`, aligns with `Object.is`).
 * - `+0` is considered equal to `-0` (standard `===` behavior).
 * - `undefined` object values are treated as the key being absent (JSON semantics).
 * - Cycles throw `DeltaError('CIRCULAR_REFERENCE')`.
 */
export function deepEqual(a: JsonValue, b: JsonValue): boolean {
  return deepEqualInner(a, b, new WeakSet(), new WeakSet());
}

/**
 * Inner recursive worker for {@link deepEqual}.
 *
 * Carries two `WeakSet`s to track visited object references (one per
 * argument side) and throws {@link DeltaError} with code
 * `CIRCULAR_REFERENCE` when a cycle is detected.
 */
function deepEqualInner(
  a: JsonValue,
  b: JsonValue,
  seenA: WeakSet<object>,
  seenB: WeakSet<object>,
): boolean {
  if (a === b) return true;

  // NaN equality
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (seenA.has(a as object) || seenB.has(b as object)) {
    throw new DeltaError('CIRCULAR_REFERENCE', 'Cycle detected during deep equality');
  }
  seenA.add(a as object);
  seenB.add(b as object);

  try {
    if (isArray(a) && isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqualInner(a[i], b[i], seenA, seenB)) return false;
      }
      return true;
    }

    if (isObject(a) && isObject(b)) {
      const ka = Object.keys(a).filter((k) => a[k] !== undefined);
      const kb = Object.keys(b).filter((k) => b[k] !== undefined);
      if (ka.length !== kb.length) return false;
      for (const k of ka) {
        if (!Object.hasOwn(b, k) || b[k] === undefined) return false;
        if (!deepEqualInner(a[k], b[k], seenA, seenB)) return false;
      }
      return true;
    }

    return false;
  } finally {
    seenA.delete(a as object);
    seenB.delete(b as object);
  }
}

// ── JSON Pointer (RFC 6901) ───────────────────

/**
 * Escape a single path segment according to RFC 6901.
 *
 * `~` → `~0`, `/` → `~1`. Order matters: tilde is escaped first to avoid
 * double-encoding.
 */
function escapeSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Unescape a single RFC 6901 path segment.
 *
 * `~1` → `/`, `~0` → `~`. Reversal order matters: slash is unescaped first
 * to avoid double-decoding.
 */
function unescapeSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Append one or more segments to a base JSON Pointer path.
 *
 * Each segment is escaped per RFC 6901 before being appended. Numeric
 * segments are stringified automatically.
 *
 * @param base - The base path (e.g. `''` for root, or `'/items'`).
 * @param segs - One or more segments to append.
 * @returns The concatenated RFC 6901 path.
 *
 * @example
 * ```ts
 * joinPath('', 'users', 0, 'name') // → '/users/0/name'
 * ```
 */
export function joinPath(base: string, ...segs: (string | number)[]): string {
  return segs.reduce<string>((acc, seg) => {
    return `${acc}/${escapeSegment(String(seg))}`;
  }, base);
}

/**
 * Split an RFC 6901 JSON Pointer into its unescaped segments.
 *
 * The empty string `''` (root pointer) returns an empty array.
 *
 * @param path - An RFC 6901 JSON Pointer (e.g. `'/users/0/name'`).
 * @returns Array of unescaped path segments.
 *
 * @example
 * ```ts
 * splitPath('/users/0/name') // → ['users', '0', 'name']
 * splitPath('')              // → []
 * ```
 */
export function splitPath(path: string): string[] {
  if (path === '') return [];
  return path.slice(1).split('/').map(unescapeSegment);
}

// ── Safe property assignment ──────────────────

/**
 * Assign `value` to `obj[key]` without triggering the `__proto__` setter.
 * For keys other than `__proto__`, this is equivalent to `obj[key] = value`.
 * For `__proto__`, it installs an own data property (no prototype replacement).
 */
export function safeSet(obj: JsonObject, key: string, value: JsonValue): void {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    obj[key] = value;
  }
}

// ── Immutable deep clone ──────────────────────

/**
 * Structural deep clone of a JSON value.
 *
 * - Cycles throw `DeltaError('CIRCULAR_REFERENCE')`.
 * - `undefined` object values are dropped (JSON semantics).
 * - `__proto__` keys are preserved as own properties (no prototype pollution).
 */
export function cloneDeep<T extends JsonValue>(val: T): T {
  return cloneDeepInner(val, new WeakSet()) as T;
}

/**
 * Inner recursive worker for {@link cloneDeep}.
 *
 * Tracks visited references in a `WeakSet` and throws {@link DeltaError}
 * with code `CIRCULAR_REFERENCE` when a cycle is detected. Object keys
 * with `undefined` values are dropped to maintain JSON semantics.
 */
function cloneDeepInner(val: JsonValue, seen: WeakSet<object>): JsonValue {
  if (val === null || typeof val !== 'object') return val;

  if (seen.has(val as object)) {
    throw new DeltaError('CIRCULAR_REFERENCE', 'Cycle detected during deep clone');
  }
  seen.add(val as object);

  try {
    if (isArray(val)) {
      const out: JsonValue[] = new Array(val.length);
      for (let i = 0; i < val.length; i++) out[i] = cloneDeepInner(val[i], seen);
      return out;
    }

    const out: JsonObject = {};
    for (const key of Object.keys(val as JsonObject)) {
      const v = (val as JsonObject)[key];
      if (v === undefined) continue;
      safeSet(out, key, cloneDeepInner(v, seen));
    }
    return out;
  } finally {
    seen.delete(val as object);
  }
}
