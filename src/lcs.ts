// ─────────────────────────────────────────────
//  delta:// — Longest Common Subsequence
//  Used for positional (non-identity) array diffs
// ─────────────────────────────────────────────

import type { JsonValue } from './types.js';

/**
 * A matched index pair from the Longest Common Subsequence computation.
 *
 * Represents a single element that appears in both the `before` and `after`
 * arrays at the given positions.
 */
export interface LCSMatch {
  /** Index of the matched element in the `before` (source) array. */
  aIndex: number;
  /** Index of the matched element in the `after` (target) array. */
  bIndex: number;
}

/**
 * Compute the LCS between two arrays.
 * Returns matched index pairs from both arrays.
 *
 * Uses the classic O(mn) DP approach.
 * For very large arrays (>2000 items), consider using
 * a sparse Myers diff instead — but this covers most real models.
 */
export function computeLCS(
  a: JsonValue[],
  b: JsonValue[],
  equal: (x: JsonValue, y: JsonValue) => boolean,
): LCSMatch[] {
  const m = a.length;
  const n = b.length;

  // Use typed arrays for speed on large inputs
  const dp = new Uint32Array((m + 1) * (n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const idx = i * (n + 1) + j;
      if (equal(a[i - 1], b[j - 1])) {
        dp[idx] = dp[(i - 1) * (n + 1) + (j - 1)] + 1;
      } else {
        const up = dp[(i - 1) * (n + 1) + j];
        const left = dp[i * (n + 1) + (j - 1)];
        dp[idx] = up > left ? up : left;
      }
    }
  }

  // Backtrack to find matched pairs
  const matches: LCSMatch[] = [];
  let i = m,
    j = n;

  while (i > 0 && j > 0) {
    if (equal(a[i - 1], b[j - 1])) {
      matches.unshift({ aIndex: i - 1, bIndex: j - 1 });
      i--;
      j--;
    } else if (dp[(i - 1) * (n + 1) + j] > dp[i * (n + 1) + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}

/**
 * Diff two arrays positionally using LCS.
 * Returns three sets of indices:
 *  - `removed`  indices in `a` not in LCS
 *  - `added`    indices in `b` not in LCS
 *  - `kept`     matched pairs
 */
export function lcsArrayDiff(
  a: JsonValue[],
  b: JsonValue[],
  equal: (x: JsonValue, y: JsonValue) => boolean,
): {
  removed: number[];
  added: number[];
  kept: LCSMatch[];
} {
  const kept = computeLCS(a, b, equal);
  const keptA = new Set(kept.map((m) => m.aIndex));
  const keptB = new Set(kept.map((m) => m.bIndex));

  const removed = a.map((_, i) => i).filter((i) => !keptA.has(i));
  const added = b.map((_, i) => i).filter((i) => !keptB.has(i));

  return { removed, added, kept };
}
