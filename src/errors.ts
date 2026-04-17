// ─────────────────────────────────────────────
//  delta:// — error types
// ─────────────────────────────────────────────

/**
 * Base error class for all delta-specific failures.
 * Carries an optional JSON Pointer path for contextual diagnostics.
 */
export class DeltaError extends Error {
  public readonly code: DeltaErrorCode;
  public readonly path: string | undefined;

  /**
   * @param code    - Machine-readable error code from {@link DeltaErrorCode}.
   * @param message - Human-readable description of the failure.
   * @param path    - Optional RFC 6901 JSON Pointer where the error occurred.
   *                  When provided, it is appended to the `message` for diagnostics.
   */
  constructor(code: DeltaErrorCode, message: string, path?: string) {
    super(path !== undefined ? `${message} (at ${path || '<root>'})` : message);
    this.name = 'DeltaError';
    this.code = code;
    this.path = path;
    // Preserve prototype chain under ES5 targets / transpilers
    Object.setPrototypeOf(this, DeltaError.prototype);
  }
}

/**
 * Machine-readable error codes emitted by the delta library.
 *
 * Use these to programmatically handle specific failure modes:
 * ```ts
 * try { patch(doc, result); }
 * catch (e) {
 *   if (e instanceof DeltaError && e.code === 'PATH_NOT_FOUND') { … }
 * }
 * ```
 */
export type DeltaErrorCode =
  /** A cyclic reference was encountered while traversing the document. */
  | 'CIRCULAR_REFERENCE'
  /** A DiffResult passed to patch/unpatch is malformed. */
  | 'INVALID_DIFF_RESULT'
  /** A DiffOp passed to patch/unpatch is malformed. */
  | 'INVALID_OPERATION'
  /** A path references a node that does not exist when it should. */
  | 'PATH_NOT_FOUND'
  /** A value is not representable as JSON (e.g. undefined in an array slot, function). */
  | 'UNSUPPORTED_VALUE'
  /** An array is too large for the O(mn) LCS algorithm. Use `arrayIdentity` instead. */
  | 'ARRAY_TOO_LARGE';
