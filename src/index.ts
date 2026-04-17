// ─────────────────────────────────────────────
//  delta:// — public API
//  @websublime/delta
// ─────────────────────────────────────────────

// ── Core operations ──────────────────────────

export { diff } from './diff.js';
export { patch, unpatch } from './patch.js';
export { snapshot } from './snapshot.js';

// ── RFC 6902 adapter ─────────────────────────

export { toRFC6902, toRFC6902JSON } from './rfc6902.js';
export type {
  RFC6902Add,
  RFC6902Move,
  RFC6902Op,
  RFC6902Patch,
  RFC6902Remove,
  RFC6902Replace,
} from './rfc6902.js';

// ── Error handling ───────────────────────────

export { DeltaError, type DeltaErrorCode } from './errors.js';

// ── Types ────────────────────────────────────

export type {
  // Operations
  DiffOp,
  // Options
  DiffOptions,
  // Result
  DiffResult,
  DiffSummary,
  // Identity
  Identity,
  IdentityFn,
  IdentityKey,
  // Values
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OpAdd,
  OpMove,
  OpRemove,
  OpReplace,
} from './types.js';
