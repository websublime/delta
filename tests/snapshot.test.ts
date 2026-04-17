import { describe, expect, it } from 'vitest';
import { snapshot, diff } from '../src/index.js';

describe('snapshot — no snapshot', () => {
  it('returns null for identical primitives', () => {
    expect(snapshot(diff(42, 42))).toBeNull();
  });

  it('returns null for identical objects', () => {
    expect(snapshot(diff({ a: 1, b: 2 }, { a: 1, b: 2 }))).toBeNull();
  });

  it('returns null for identical arrays', () => {
    expect(snapshot(diff([1, 2, 3], [1, 2, 3]))).toBeNull();
  });
});

describe('snapshot — object diffs', () => {
  it('returns only added keys', () => {
    expect(snapshot(diff({ a: 1 }, { a: 1, b: 2 }))).toEqual({ b: 2 });
  });

  it('returns null for removed keys', () => {
    expect(snapshot(diff({ a: 1, b: 2 }, { a: 1 }))).toEqual({ b: null });
  });

  it('returns replaced values', () => {
    expect(snapshot(diff({ a: 1 }, { a: 99 }))).toEqual({ a: 99 });
  });

  it('splits additions, replacements and removals', () => {
    const before = { name: 'Alice', age: 30, email: 'a@b.c' };
    const after = { name: 'Bob', age: 30, role: 'admin' };

    expect(snapshot(diff(before, after))).toEqual({
      name: 'Bob',
      role: 'admin',
      email: null,
    });
  });

  it('handles multiple snapshot across different types', () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 99, c: 3, d: 4 };

    const result = snapshot(diff(before, after));
    expect(result).toEqual({ a: 99, b: null, d: 4 });
  });
});

describe('snapshot — nested objects', () => {
  it('preserves sparse nested structure', () => {
    const before = { user: { name: 'Alice', settings: { theme: 'dark', lang: 'en' } } };
    const after = { user: { name: 'Alice', settings: { theme: 'light', lang: 'en' } } };

    expect(snapshot(diff(before, after))).toEqual({
      user: { settings: { theme: 'light' } },
    });
  });

  it('handles deeply nested additions', () => {
    const before = { a: { b: { c: 1 } } };
    const after = { a: { b: { c: 1, d: 2 } } };

    expect(snapshot(diff(before, after))).toEqual({ a: { b: { d: 2 } } });
  });

  it('handles deeply nested removals as null', () => {
    const before = { a: { b: { c: 1, d: 2 } } };
    const after = { a: { b: { c: 1 } } };

    expect(snapshot(diff(before, after))).toEqual({ a: { b: { d: null } } });
  });

  it('handles mixed nested additions and removals', () => {
    const before = { x: { y: 1, z: 2 }, w: 3 };
    const after = { x: { y: 99 }, w: 3, v: 4 };

    expect(snapshot(diff(before, after))).toEqual({
      x: { y: 99, z: null },
      v: 4,
    });
  });
});

describe('snapshot — root replacement', () => {
  it('returns the new value for primitive → primitive', () => {
    expect(snapshot(diff(1, 2))).toBe(2);
  });

  it('returns the new value when root type snapshot', () => {
    expect(snapshot(diff('hello', { a: 1 }))).toEqual({ a: 1 });
  });

  it('returns the new value when object → array', () => {
    expect(snapshot(diff({ a: 1 }, [1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe('snapshot — arrays (positional)', () => {
  it('represents array snapshot as sparse object with string keys', () => {
    const result = snapshot(diff([1, 2, 3], [1, 99, 3]));
    // LCS: remove index 1, add index 1
    expect(result).toHaveProperty('1');
  });

  it('root-level array add', () => {
    const result = snapshot(diff([1, 2], [1, 2, 3]));
    expect(result).toEqual({ '2': 3 });
  });

  it('root-level array remove', () => {
    const result = snapshot(diff([1, 2, 3], [1, 3]));
    // Remove at index 1 (value 2)
    expect(result).toHaveProperty('1');
  });
});

describe('snapshot — arrays with identity', () => {
  it('includes moved items at their destination index', () => {
    const before = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const after = [
      { id: 2, name: 'Bob' },
      { id: 1, name: 'Alice' },
    ];

    const result = snapshot(diff(before, after, { arrayIdentity: 'id' }));
    expect(result).toEqual({
      '0': { id: 2, name: 'Bob' },
      '1': { id: 1, name: 'Alice' },
    });
  });

  it('includes added items in nested array', () => {
    const before = { items: [{ id: 1, v: 'a' }] };
    const after = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };

    expect(snapshot(diff(before, after, { arrayIdentity: 'id' }))).toEqual({
      items: { '1': { id: 2, v: 'b' } },
    });
  });

  it('removed array items appear as null', () => {
    const before = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const after = { items: [{ id: 1, v: 'a' }] };

    const result = snapshot(diff(before, after, { arrayIdentity: 'id' })) as Record<string, Record<string, unknown>>;
    // The removed item index should be null
    const itemsChanges = result.items;
    const removedKey = Object.keys(itemsChanges).find((k) => itemsChanges[k] === null);
    expect(removedKey).toBeDefined();
  });

  it('handles moved-and-changed items', () => {
    const before = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const after = { items: [{ id: 2, v: 'X' }, { id: 1, v: 'a' }] };

    const result = snapshot(diff(before, after, { arrayIdentity: 'id' })) as Record<string, Record<string, unknown>>;
    expect(result.items['0']).toEqual({ id: 2, v: 'X' });
  });
});

describe('snapshot — options forwarding via diff', () => {
  it('respects ignore option', () => {
    const before = { a: 1, b: 2, meta: { ts: 100 } };
    const after = { a: 99, b: 2, meta: { ts: 200 } };

    expect(snapshot(diff(before, after, { ignore: ['/meta/ts'] }))).toEqual({ a: 99 });
  });

  it('respects maxDepth option', () => {
    const before = { a: { b: { c: 1 } } };
    const after = { a: { b: { c: 2 } } };

    // At depth 1, the entire nested object is replaced as a blob
    expect(snapshot(diff(before, after, { maxDepth: 1 }))).toEqual({
      a: { b: { c: 2 } },
    });
  });
});

describe('snapshot — only removals', () => {
  it('returns object with null values for all removed keys', () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 1 };

    expect(snapshot(diff(before, after))).toEqual({ b: null, c: null });
  });
});
