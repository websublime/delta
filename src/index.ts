// ─────────────────────────────────────────────
//  delta:// — public API
//  @websublime/delta
// ─────────────────────────────────────────────

export { diff } from './diff.js';
export { DeltaError, type DeltaErrorCode } from './errors.js';
export { patch, unpatch } from './patch.js';
export type {
  RFC6902Add,
  RFC6902Move,
  RFC6902Op,
  RFC6902Patch,
  RFC6902Remove,
  RFC6902Replace,
} from './rfc6902.js';
export { toRFC6902, toRFC6902JSON } from './rfc6902.js';
export type {
  // Operations
  DiffOp,
  // Options
  DiffOptions,
  // Result
  DiffResult,
  DiffSummary,
  Identity,
  IdentityFn,
  IdentityKey,
  JsonArray,
  JsonObject,
  // Values
  JsonPrimitive,
  JsonValue,
  OpAdd,
  OpMove,
  OpRemove,
  OpReplace,
} from './types.js';
