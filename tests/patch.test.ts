import { describe, expect, it } from 'vitest';
import { diff, patch, unpatch } from '../src/index.js';
import type { DiffOptions, JsonValue } from '../src/types.js';

/** Assert that patch(before) === after AND unpatch(after) === before */
function roundtrip(before: JsonValue, after: JsonValue, opts?: DiffOptions) {
  const result = diff(before, after, opts);
  const patched = patch(before, result);
  const unpatched = unpatch(after, result);
  expect(patched).toEqual(after);
  expect(unpatched).toEqual(before);
}

describe('patch / unpatch — primitives', () => {
  it('number → number', () => roundtrip(1, 2));
  it('string → string', () => roundtrip('hello', 'world'));
  it('null → object', () => roundtrip(null, { a: 1 }));
  it('object → null', () => roundtrip({ a: 1 }, null));
  it('no-change is identity', () => roundtrip(42, 42));
});

describe('patch / unpatch — objects', () => {
  it('add key', () => roundtrip({ a: 1 }, { a: 1, b: 2 }));
  it('remove key', () => roundtrip({ a: 1, b: 2 }, { a: 1 }));
  it('replace value', () => roundtrip({ a: 1 }, { a: 99 }));
  it('multiple changes', () => roundtrip({ a: 1, b: 2, c: 3 }, { a: 99, d: 4 }));
  it('deeply nested', () => roundtrip({ a: { b: { c: 1 } } }, { a: { b: { c: 99 } } }));
  it('does not mutate inputs', () => {
    const before = { a: 1 };
    const after = { a: 2 };
    const result = diff(before, after);
    patch(before, result);
    unpatch(after, result);
    expect(before).toEqual({ a: 1 });
    expect(after).toEqual({ a: 2 });
  });
});

describe('patch / unpatch — arrays (LCS)', () => {
  it('append item', () => roundtrip([1, 2], [1, 2, 3]));
  it('remove item', () => roundtrip([1, 2, 3], [1, 3]));
  it('mixed changes', () => roundtrip([1, 2, 3], [1, 99, 4]));
  it('empty → populated', () => roundtrip([], [1, 2, 3]));
  it('populated → empty', () => roundtrip([1, 2, 3], []));
  it('array inside object', () => roundtrip({ items: [1, 2, 3] }, { items: [1, 99] }));
});

describe('patch / unpatch — identity arrays', () => {
  it('simple 2-item swap', () => {
    roundtrip([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], { arrayIdentity: 'id' });
  });

  it('3-item rotation', () => {
    roundtrip([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 3 }, { id: 1 }, { id: 2 }], {
      arrayIdentity: 'id',
    });
  });

  it('full reverse of 4 items', () => {
    roundtrip(
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      [{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }],
      { arrayIdentity: 'id' },
    );
  });

  it('move + add + remove', () => {
    roundtrip([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 2 }, { id: 4 }], { arrayIdentity: 'id' });
  });

  it('move + nested value change', () => {
    roundtrip(
      [
        { id: 1, role: 'admin' },
        { id: 2, role: 'user' },
      ],
      [
        { id: 2, role: 'mod' },
        { id: 1, role: 'admin' },
      ],
      { arrayIdentity: 'id' },
    );
  });

  it('array inside object property', () => {
    roundtrip(
      {
        users: [
          { id: 'a', v: 1 },
          { id: 'b', v: 2 },
        ],
      },
      {
        users: [
          { id: 'b', v: 99 },
          { id: 'a', v: 1 },
        ],
      },
      { arrayIdentity: 'id' },
    );
  });

  it('complex: reorder + role change', () => {
    roundtrip(
      {
        users: [
          { id: 1, role: 'admin' },
          { id: 2, role: 'user' },
          { id: 3, role: 'mod' },
        ],
      },
      {
        users: [
          { id: 3, role: 'mod' },
          { id: 1, role: 'superadmin' },
          { id: 2, role: 'user' },
        ],
      },
      { arrayIdentity: 'id' },
    );
  });
});

describe('patch — oldValue recovery', () => {
  it('unpatch works without the original document', () => {
    const before = { a: { nested: [1, 2, 3] } };
    const after = { a: { nested: [3, 1] }, b: 'new' };
    const result = diff(before, after);
    // unpatch only needs `after` + the diff result — no `before`
    expect(unpatch(after, result)).toEqual(before);
  });
});
