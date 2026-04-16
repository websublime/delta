import { applyPatch, deepClone } from 'fast-json-patch';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diff } from '../src/index.js';
import { toRFC6902 } from '../src/rfc6902.js';
import type { JsonValue } from '../src/types.js';

// ── Arbitraries (duplicated from properties.test.ts, kept standalone). ──

const leafArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.string({ maxLength: 8 }),
);

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

// ── Sanity ────────────────────────────────────

describe('RFC 6902 conformance (fast-json-patch applies our output)', () => {
  it('add → fast-json-patch reaches the same after', () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };
    const ops = toRFC6902(diff(before, after));
    const patched = applyPatch(deepClone(before), ops).newDocument;
    expect(patched).toEqual(after);
  });

  it('remove → fast-json-patch reaches the same after', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1 };
    const ops = toRFC6902(diff(before, after));
    const patched = applyPatch(deepClone(before), ops).newDocument;
    expect(patched).toEqual(after);
  });

  it('replace → fast-json-patch reaches the same after', () => {
    const before = { a: 1 };
    const after = { a: 99 };
    const ops = toRFC6902(diff(before, after));
    const patched = applyPatch(deepClone(before), ops).newDocument;
    expect(patched).toEqual(after);
  });

  it('LCS array changes are accepted by fast-json-patch', () => {
    const before = [1, 2, 3, 4, 5];
    const after = [1, 99, 3, 88, 5];
    const ops = toRFC6902(diff(before, after));
    const patched = applyPatch(deepClone(before), ops).newDocument;
    expect(patched).toEqual(after);
  });

  it('property: conformance on arbitrary JSON (no identity, no moves)', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (before, after) => {
        const ops = toRFC6902(diff(before, after));
        const patched = applyPatch(deepClone(before as object), ops, true, false).newDocument;
        expect(patched).toEqual(after);
      }),
      { numRuns: 200 },
    );
  });
});
