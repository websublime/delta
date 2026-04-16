import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diff, patch, unpatch } from '../src/index.js';
import type { JsonValue } from '../src/types.js';

// ── Arbitraries ───────────────────────────────

/** A JSON-safe leaf value. */
const leafArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.string({ maxLength: 8 }),
);

/** A small JSON tree (depth-bounded to keep test time sane). */
const jsonArb: fc.Arbitrary<JsonValue> = fc.letrec<{ node: JsonValue }>((tie) => ({
  node: fc.oneof(
    { weight: 5, arbitrary: leafArb },
    { weight: 1, arbitrary: fc.array(tie('node'), { maxLength: 5 }) },
    {
      weight: 1,
      arbitrary: fc
        .dictionary(fc.string({ maxLength: 6 }), tie('node'), { maxKeys: 5 })
        .map((o) => o as JsonValue),
    },
  ),
})).node;

/** An identity-array pair: two arrays of `{id, v}` objects sharing some ids. */
const identityPair = fc
  .tuple(
    fc.array(fc.record({ id: fc.integer({ min: 1, max: 10 }), v: fc.string({ maxLength: 4 }) }), {
      maxLength: 6,
    }),
    fc.array(fc.record({ id: fc.integer({ min: 1, max: 10 }), v: fc.string({ maxLength: 4 }) }), {
      maxLength: 6,
    }),
  )
  .map(([a, b]) => [a as JsonValue, b as JsonValue] as const);

// ── Properties ────────────────────────────────

describe('property: roundtrip on arbitrary JSON', () => {
  it('patch(before, diff(before, after)) ≡ after', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        expect(patch(before, r)).toEqual(after);
      }),
      { numRuns: 200 },
    );
  });

  it('unpatch(after, diff(before, after)) ≡ before', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        expect(unpatch(after, r)).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: identity arrays (with duplicates)', () => {
  it('roundtrip with arrayIdentity:id', () => {
    fc.assert(
      fc.property(identityPair, ([before, after]) => {
        const r = diff(before, after, { arrayIdentity: 'id' });
        expect(patch(before, r)).toEqual(after);
        expect(unpatch(after, r)).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });

  it('roundtrip with arrayIdentity:id AND detectMoves:false', () => {
    fc.assert(
      fc.property(identityPair, ([before, after]) => {
        const r = diff(before, after, { arrayIdentity: 'id', detectMoves: false });
        expect(r.operations.some((op) => op.op === 'move')).toBe(false);
        expect(patch(before, r)).toEqual(after);
        expect(unpatch(after, r)).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: result invariants', () => {
  it('hasChanges ⇔ operations.length > 0', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        expect(r.hasChanges).toBe(r.operations.length > 0);
      }),
      { numRuns: 200 },
    );
  });

  it('summary.total === operations.length', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        expect(r.summary.total).toBe(r.operations.length);
      }),
      { numRuns: 200 },
    );
  });

  it('summary counts match op categories', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        const counts = { add: 0, remove: 0, replace: 0, move: 0 };
        for (const op of r.operations) counts[op.op]++;
        expect(r.summary.added).toBe(counts.add);
        expect(r.summary.removed).toBe(counts.remove);
        expect(r.summary.replaced).toBe(counts.replace);
        expect(r.summary.moved).toBe(counts.move);
      }),
      { numRuns: 200 },
    );
  });

  it('changedPaths equals the set of op paths', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        const expected = new Set(r.operations.map((op) => op.path));
        expect(r.changedPaths).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('identical inputs produce no changes', () => {
    fc.assert(
      fc.property(jsonArb, (v) => {
        const r = diff(v, v);
        expect(r.hasChanges).toBe(false);
        expect(r.operations).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: determinism', () => {
  it('diff is deterministic (same inputs → same output)', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r1 = diff(before, after);
        const r2 = diff(before, after);
        expect(r2.operations).toEqual(r1.operations);
      }),
      { numRuns: 200 },
    );
  });

  it('identity diff is deterministic under duplicates', () => {
    fc.assert(
      fc.property(identityPair, ([before, after]) => {
        const r1 = diff(before, after, { arrayIdentity: 'id' });
        const r2 = diff(before, after, { arrayIdentity: 'id' });
        expect(r2.operations).toEqual(r1.operations);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: input mutation safety', () => {
  it('diff does not mutate inputs', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const beforeSnap = JSON.stringify(before);
        const afterSnap = JSON.stringify(after);
        diff(before, after);
        expect(JSON.stringify(before)).toBe(beforeSnap);
        expect(JSON.stringify(after)).toBe(afterSnap);
      }),
      { numRuns: 100 },
    );
  });

  it('patch does not mutate its input', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const r = diff(before, after);
        const beforeSnap = JSON.stringify(before);
        patch(before, r);
        expect(JSON.stringify(before)).toBe(beforeSnap);
      }),
      { numRuns: 100 },
    );
  });
});
