import { describe, expect, it } from 'vitest';
import { changes, changesFromDiff, diff } from '../src/index.js';

describe('changes — no changes', () => {
  it('returns hasChanges false for identical primitives', () => {
    const r = changes(42, 42);
    expect(r.hasChanges).toBe(false);
    expect(r.updated).toBeNull();
    expect(r.removed).toEqual([]);
  });

  it('returns hasChanges false for identical objects', () => {
    const r = changes({ a: 1, b: 2 }, { a: 1, b: 2 });
    expect(r.hasChanges).toBe(false);
    expect(r.updated).toBeNull();
    expect(r.removed).toEqual([]);
  });

  it('returns hasChanges false for identical arrays', () => {
    const r = changes([1, 2, 3], [1, 2, 3]);
    expect(r.hasChanges).toBe(false);
    expect(r.updated).toBeNull();
  });
});

describe('changes — object diffs', () => {
  it('detects added keys in updated', () => {
    const r = changes({ a: 1 }, { a: 1, b: 2 });
    expect(r.hasChanges).toBe(true);
    expect(r.updated).toEqual({ b: 2 });
    expect(r.removed).toEqual([]);
  });

  it('detects removed keys in removed', () => {
    const r = changes({ a: 1, b: 2 }, { a: 1 });
    expect(r.hasChanges).toBe(true);
    expect(r.updated).toBeNull();
    expect(r.removed).toEqual(['/b']);
  });

  it('detects replaced values in updated', () => {
    const r = changes({ a: 1 }, { a: 99 });
    expect(r.hasChanges).toBe(true);
    expect(r.updated).toEqual({ a: 99 });
    expect(r.removed).toEqual([]);
  });

  it('splits additions and removals correctly', () => {
    const before = { name: 'Alice', age: 30, email: 'a@b.c' };
    const after = { name: 'Bob', age: 30, role: 'admin' };

    const r = changes(before, after);
    expect(r.updated).toEqual({ name: 'Bob', role: 'admin' });
    expect(r.removed).toEqual(['/email']);
  });

  it('handles multiple changes across different types', () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 99, c: 3, d: 4 };

    const r = changes(before, after);
    expect(r.updated).toEqual({ a: 99, d: 4 });
    expect(r.removed).toContain('/b');
  });
});

describe('changes — nested objects', () => {
  it('preserves nested structure in updated', () => {
    const before = { user: { name: 'Alice', settings: { theme: 'dark', lang: 'en' } } };
    const after = { user: { name: 'Alice', settings: { theme: 'light', lang: 'en' } } };

    const r = changes(before, after);
    expect(r.updated).toEqual({ user: { settings: { theme: 'light' } } });
    expect(r.removed).toEqual([]);
  });

  it('handles deeply nested additions', () => {
    const before = { a: { b: { c: 1 } } };
    const after = { a: { b: { c: 1, d: 2 } } };

    const r = changes(before, after);
    expect(r.updated).toEqual({ a: { b: { d: 2 } } });
  });

  it('handles deeply nested removals', () => {
    const before = { a: { b: { c: 1, d: 2 } } };
    const after = { a: { b: { c: 1 } } };

    const r = changes(before, after);
    expect(r.updated).toBeNull();
    expect(r.removed).toEqual(['/a/b/d']);
  });

  it('handles mixed nested additions and removals', () => {
    const before = { x: { y: 1, z: 2 }, w: 3 };
    const after = { x: { y: 99 }, w: 3, v: 4 };

    const r = changes(before, after);
    expect(r.updated).toEqual({ x: { y: 99 }, v: 4 });
    expect(r.removed).toContain('/x/z');
  });
});

describe('changes — root replacement', () => {
  it('returns the new value when root is replaced (primitive → primitive)', () => {
    const r = changes(1, 2);
    expect(r.hasChanges).toBe(true);
    expect(r.updated).toBe(2);
    expect(r.removed).toEqual([]);
  });

  it('returns the new value when root type changes', () => {
    const r = changes('hello', { a: 1 });
    expect(r.updated).toEqual({ a: 1 });
  });

  it('returns the new value when object is replaced by array', () => {
    const r = changes({ a: 1 }, [1, 2, 3]);
    expect(r.updated).toEqual([1, 2, 3]);
  });
});

describe('changes — arrays with identity', () => {
  it('includes moved items at their destination index', () => {
    const before = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const after = [
      { id: 2, name: 'Bob' },
      { id: 1, name: 'Alice' },
    ];

    const r = changes(before, after, { arrayIdentity: 'id' });
    expect(r.hasChanges).toBe(true);
    expect(r.updated).not.toBeNull();
    // Moved items appear under their new indices
    const updated = r.updated as Record<string, unknown>;
    expect(updated['0']).toEqual({ id: 2, name: 'Bob' });
    expect(updated['1']).toEqual({ id: 1, name: 'Alice' });
  });

  it('includes added items and excludes removed from updated', () => {
    const before = { items: [{ id: 1, v: 'a' }] };
    const after = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };

    const r = changes(before, after, { arrayIdentity: 'id' });
    expect(r.updated).toEqual({ items: { '1': { id: 2, v: 'b' } } });
    expect(r.removed).toEqual([]);
  });

  it('lists removed array items in removed', () => {
    const before = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const after = { items: [{ id: 1, v: 'a' }] };

    const r = changes(before, after, { arrayIdentity: 'id' });
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]).toMatch(/^\/items\/\d+$/);
  });

  it('handles moved-and-changed items', () => {
    const before = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const after = { items: [{ id: 2, v: 'X' }, { id: 1, v: 'a' }] };

    const r = changes(before, after, { arrayIdentity: 'id' });
    expect(r.hasChanges).toBe(true);
    expect(r.updated).not.toBeNull();
    // The moved item with changed value should appear at its new index
    const updated = r.updated as Record<string, Record<string, unknown>>;
    expect(updated.items['0']).toEqual({ id: 2, v: 'X' });
  });
});

describe('changes — options forwarding', () => {
  it('respects ignore option', () => {
    const before = { a: 1, b: 2, meta: { ts: 100 } };
    const after = { a: 99, b: 2, meta: { ts: 200 } };

    const r = changes(before, after, { ignore: ['/meta/ts'] });
    expect(r.updated).toEqual({ a: 99 });
    expect(r.removed).toEqual([]);
  });

  it('respects maxDepth option', () => {
    const before = { a: { b: { c: 1 } } };
    const after = { a: { b: { c: 2 } } };

    const r = changes(before, after, { maxDepth: 1 });
    // At depth 1, the entire nested object is replaced as a blob
    expect(r.updated).toEqual({ a: { b: { c: 2 } } });
  });
});

describe('changesFromDiff — standalone usage', () => {
  it('produces same result as changes() from a pre-computed diff', () => {
    const before = { name: 'Alice', age: 30 };
    const after = { name: 'Bob', age: 30, role: 'admin' };

    const result = diff(before, after);
    const fromChanges = changes(before, after);
    const fromDiff = changesFromDiff(result);

    expect(fromDiff.hasChanges).toBe(fromChanges.hasChanges);
    expect(fromDiff.updated).toEqual(fromChanges.updated);
    expect(fromDiff.removed).toEqual(fromChanges.removed);
  });

  it('provides access to the underlying DiffResult', () => {
    const result = diff({ a: 1 }, { a: 2 });
    const r = changesFromDiff(result);

    expect(r.diff).toBe(result);
    expect(r.diff.operations).toHaveLength(1);
    expect(r.diff.summary.replaced).toBe(1);
  });

  it('handles empty diff result', () => {
    const result = diff(42, 42);
    const r = changesFromDiff(result);

    expect(r.hasChanges).toBe(false);
    expect(r.updated).toBeNull();
    expect(r.removed).toEqual([]);
  });
});

describe('changes — only removals', () => {
  it('returns null updated when only removals exist', () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 1 };

    const r = changes(before, after);
    expect(r.updated).toBeNull();
    expect(r.removed).toContain('/b');
    expect(r.removed).toContain('/c');
    expect(r.removed).toHaveLength(2);
  });
});
