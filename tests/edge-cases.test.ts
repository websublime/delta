import { describe, expect, it } from 'vitest';
import { DeltaError, diff, patch, unpatch } from '../src/index.js';

/** Assert `patch(before) === after` AND `unpatch(after) === before`. */
function roundtrip<T>(before: T, after: T, opts?: Parameters<typeof diff>[2]) {
  const r = diff(before as never, after as never, opts);
  expect(patch(before as never, r)).toEqual(after);
  expect(unpatch(after as never, r)).toEqual(before);
}

describe('regression: detectMoves:false', () => {
  it('3-item rotation round-trips correctly', () => {
    roundtrip(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 3 }, { id: 1 }, { id: 2 }],
      { arrayIdentity: 'id', detectMoves: false },
    );
  });

  it('4-item reverse round-trips', () => {
    roundtrip(
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      [{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }],
      { arrayIdentity: 'id', detectMoves: false },
    );
  });

  it('remove + move + add mix', () => {
    roundtrip([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 4 }, { id: 2 }, { id: 1 }], {
      arrayIdentity: 'id',
      detectMoves: false,
    });
  });

  it('emits no move ops', () => {
    const r = diff(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 3 }, { id: 1 }, { id: 2 }],
      { arrayIdentity: 'id', detectMoves: false },
    );
    expect(r.operations.some((op) => op.op === 'move')).toBe(false);
  });
});

describe('regression: duplicate identity ids', () => {
  it('swap of two items with the same id', () => {
    roundtrip(
      [
        { id: 1, v: 'a' },
        { id: 1, v: 'b' },
      ],
      [
        { id: 1, v: 'b' },
        { id: 1, v: 'a' },
      ],
      { arrayIdentity: 'id' },
    );
  });

  it('scattered duplicates round-trip', () => {
    roundtrip(
      [
        { id: 1, v: 'a' },
        { id: 2, v: 'x' },
        { id: 1, v: 'b' },
      ],
      [
        { id: 2, v: 'x' },
        { id: 1, v: 'a' },
        { id: 1, v: 'b' },
      ],
      { arrayIdentity: 'id' },
    );
  });

  it('three occurrences of the same id, rotated', () => {
    roundtrip(
      [
        { id: 1, v: 'a' },
        { id: 1, v: 'b' },
        { id: 1, v: 'c' },
      ],
      [
        { id: 1, v: 'c' },
        { id: 1, v: 'a' },
        { id: 1, v: 'b' },
      ],
      { arrayIdentity: 'id' },
    );
  });
});

describe('circular references', () => {
  it('diff throws DeltaError when `after` has a cycle', () => {
    const o: Record<string, unknown> = { x: 1 };
    o.self = o;
    expect(() => diff({}, o as never)).toThrowError(DeltaError);
  });

  it('diff throws DeltaError when `before` has a cycle', () => {
    const o: Record<string, unknown> = { x: 1 };
    o.self = o;
    expect(() => diff(o as never, {})).toThrowError(DeltaError);
  });

  it('cycles produce CIRCULAR_REFERENCE error code', () => {
    const o: Record<string, unknown> = { x: 1 };
    o.self = o;
    try {
      diff({}, o as never);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DeltaError);
      expect((e as DeltaError).code).toBe('CIRCULAR_REFERENCE');
    }
  });
});

describe('NaN / Infinity / -0', () => {
  it('NaN equals NaN', () => {
    expect(diff({ a: Number.NaN }, { a: Number.NaN }).hasChanges).toBe(false);
  });

  it('Infinity equals Infinity', () => {
    expect(diff({ a: Infinity }, { a: Infinity }).hasChanges).toBe(false);
    expect(diff({ a: -Infinity }, { a: -Infinity }).hasChanges).toBe(false);
  });

  it('+0 equals -0 (follows ===)', () => {
    expect(diff({ a: 0 }, { a: -0 }).hasChanges).toBe(false);
  });

  it('NaN → number produces a replace', () => {
    const r = diff({ a: Number.NaN }, { a: 1 });
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0].op).toBe('replace');
  });
});

describe('undefined in objects (JSON semantics)', () => {
  it('undefined is treated as an absent key', () => {
    expect(diff({ a: 1 }, { a: 1, b: undefined } as never).hasChanges).toBe(false);
  });

  it('going from defined to undefined emits a remove', () => {
    const r = diff({ a: 1, b: 2 }, { a: 1, b: undefined } as never);
    expect(r.operations).toEqual([{ op: 'remove', path: '/b', oldValue: 2 }]);
  });

  it('cloneDeep drops undefined values', () => {
    // Roundtrip semantics: patch normalizes undefined → absent.
    roundtrip({ a: 1 }, { a: 1 });
  });
});

describe('special keys & prototype-pollution safety', () => {
  it('does not pollute Object.prototype via __proto__ add', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test probes prototype safety
    const before = (Object.prototype as any).polluted;
    const malicious = JSON.parse('{"__proto__":{"polluted":true}}');
    patch({}, diff({}, malicious));
    // biome-ignore lint/suspicious/noExplicitAny: test probes prototype safety
    const after = (Object.prototype as any).polluted;
    expect(after).toBe(before);
  });

  it('preserves __proto__ as an own enumerable data property', () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":42}}');
    const cloned = patch({}, diff({}, malicious)) as Record<string, unknown>;
    expect(Object.hasOwn(cloned, '__proto__')).toBe(true);
  });

  it('handles keys named "constructor" and "prototype" as data', () => {
    roundtrip(
      { constructor: 'c1', prototype: 'p1' },
      { constructor: 'c2', prototype: 'p1' },
    );
  });

  it('handles keys named "toString" and "hasOwnProperty"', () => {
    roundtrip({ toString: 'x' }, { toString: 'y', hasOwnProperty: 'z' });
  });
});

describe('DiffResult runtime validation', () => {
  it('rejects a null result', () => {
    expect(() => patch({}, null as never)).toThrowError(DeltaError);
    expect(() => unpatch({}, null as never)).toThrowError(DeltaError);
  });

  it('rejects a result with non-array operations', () => {
    expect(() => patch({}, { operations: 'nope' } as never)).toThrow(/operations/);
  });

  it('rejects an op without a path', () => {
    expect(() =>
      patch({}, { operations: [{ op: 'add', value: 1 }] } as never),
    ).toThrowError(DeltaError);
  });

  it('rejects an unknown op code', () => {
    expect(() =>
      patch({}, { operations: [{ op: 'weird', path: '/a' }] } as never),
    ).toThrow(/unknown op/);
  });

  it('rejects add op without value', () => {
    expect(() =>
      patch({}, { operations: [{ op: 'add', path: '/a' }] } as never),
    ).toThrow(/missing 'value'/);
  });

  it('rejects remove op without oldValue', () => {
    expect(() =>
      patch({}, { operations: [{ op: 'remove', path: '/a' }] } as never),
    ).toThrow(/missing 'oldValue'/);
  });

  it('rejects replace op without value/oldValue', () => {
    expect(() =>
      patch({}, { operations: [{ op: 'replace', path: '/a', value: 1 }] } as never),
    ).toThrow(/missing 'value' or 'oldValue'/);
  });

  it('rejects move op without indices', () => {
    expect(() =>
      patch({}, {
        operations: [{ op: 'move', path: '', value: 1, oldValue: 1 }],
      } as never),
    ).toThrow(/fromIndex/);
  });
});

describe('maxDepth edge cases', () => {
  it('maxDepth: 0 treats any change as root replace', () => {
    const r = diff({ a: 1 }, { a: 2 }, { maxDepth: 0 });
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0].op).toBe('replace');
    expect(r.operations[0].path).toBe('');
  });

  it('maxDepth: Infinity recurses to the leaves', () => {
    const r = diff(
      { a: { b: { c: { d: { e: 1 } } } } },
      { a: { b: { c: { d: { e: 2 } } } } },
      { maxDepth: Infinity },
    );
    expect(r.operations[0].path).toBe('/a/b/c/d/e');
  });
});

describe('mutation safety of DiffResult', () => {
  it('mutating the DiffResult does not affect inputs', () => {
    const before = { a: 1, b: [1, 2, 3] };
    const after = { a: 2, b: [1, 2, 3, 4] };
    const snapshotBefore = JSON.stringify(before);
    const snapshotAfter = JSON.stringify(after);

    const r = diff(before, after);
    // Poison the first op's value
    const op = r.operations[0];
    if ('value' in op && typeof op.value === 'object' && op.value !== null) {
      (op.value as Record<string, unknown>).__poison__ = true;
    }

    expect(JSON.stringify(before)).toBe(snapshotBefore);
    expect(JSON.stringify(after)).toBe(snapshotAfter);
  });

  it('mutating the patched result does not affect before', () => {
    const before = { a: { nested: 1 } };
    const after = { a: { nested: 2 } };
    const snapshot = JSON.stringify(before);

    const r = diff(before, after);
    const p = patch(before, r) as { a: { nested: number; leaked?: boolean } };
    p.a.leaked = true;

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('mutating the unpatched result does not affect after', () => {
    const before = { x: [1, 2] };
    const after = { x: [1, 2, 3] };
    const snapshot = JSON.stringify(after);

    const r = diff(before, after);
    const u = unpatch(after, r) as { x: number[] };
    u.x.push(999);

    expect(JSON.stringify(after)).toBe(snapshot);
  });
});

describe('moved + nested identity array (limitation)', () => {
  it('roundtrip works even though nested granularity is lost', () => {
    roundtrip(
      [
        { id: 1, tags: ['a', 'b'] },
        { id: 2, tags: ['x'] },
      ],
      [
        { id: 2, tags: ['x'] },
        { id: 1, tags: ['b', 'a'] },
      ],
      { arrayIdentity: 'id' },
    );
  });
});

describe('numeric-like string keys on objects', () => {
  it('objects with numeric-string keys round-trip', () => {
    roundtrip({ '0': 'a', '1': 'b' }, { '0': 'a', '1': 'c' });
  });

  it('mixing numeric-string keys and normal keys', () => {
    roundtrip({ '0': 'a', name: 'x' }, { '0': 'b', name: 'y' });
  });
});

describe('cloneValues: false (reference-mode)', () => {
  it('roundtrip still works with cloneValues: false', () => {
    roundtrip({ a: 1, b: [1, 2] }, { a: 2, b: [1, 2, 3] }, { cloneValues: false });
  });

  it('operation value holds a reference into the input', () => {
    const after = { a: { leaf: 1 } };
    const r = diff({}, after, { cloneValues: false });
    const op = r.operations[0];
    expect(op.op).toBe('add');
    if (op.op === 'add') {
      // Same reference (not a clone)
      expect(op.value).toBe(after.a);
    }
  });

  it('operation value is cloned by default', () => {
    const after = { a: { leaf: 1 } };
    const r = diff({}, after);
    const op = r.operations[0];
    if (op.op === 'add') {
      expect(op.value).not.toBe(after.a);
      expect(op.value).toEqual(after.a);
    }
  });

  it('patch output is still independent from inputs with cloneValues: false', () => {
    const before = { a: 1 };
    const after = { a: 2, b: [10] };
    const r = diff(before, after, { cloneValues: false });
    const p = patch(before, r) as { b: number[] };
    p.b.push(999);
    expect(after.b).toEqual([10]);
  });
});

describe('escape/unescape path segments (RFC 6901)', () => {
  it('round-trips paths containing `/` and `~`', () => {
    roundtrip({ 'a/b': 1, 'c~d': 2 }, { 'a/b': 99, 'c~d': 3 });
  });

  it('emits correctly escaped JSON Pointer paths', () => {
    const r = diff({ 'a/b': 1 }, { 'a/b': 2 });
    expect(r.operations[0].path).toBe('/a~1b');
    const r2 = diff({ 'c~d': 1 }, { 'c~d': 2 });
    expect(r2.operations[0].path).toBe('/c~0d');
  });
});
