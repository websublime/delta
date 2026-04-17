import { describe, expect, it } from 'vitest';
import { diff } from '../src/diff.js';
import type { OpMove } from '../src/types.js';

describe('diff — primitives', () => {
  it('equal primitives produce no operations', () => {
    expect(diff(42, 42).hasChanges).toBe(false);
    expect(diff('hello', 'hello').hasChanges).toBe(false);
    expect(diff(true, true).hasChanges).toBe(false);
    expect(diff(null, null).hasChanges).toBe(false);
  });

  it('different primitives produce a replace', () => {
    const r = diff(1, 2);
    expect(r.hasChanges).toBe(true);
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0]).toMatchObject({ op: 'replace', path: '', value: 2, oldValue: 1 });
  });

  it('type changes produce a replace', () => {
    expect(diff(1, '1').operations[0].op).toBe('replace');
    expect(diff(null, false).operations[0].op).toBe('replace');
    expect(diff([], {}).operations[0].op).toBe('replace');
  });
});

describe('diff — objects', () => {
  it('detects added keys', () => {
    const r = diff({ a: 1 }, { a: 1, b: 2 });
    expect(r.summary.added).toBe(1);
    expect(r.operations[0]).toMatchObject({ op: 'add', path: '/b', value: 2 });
  });

  it('detects removed keys', () => {
    const r = diff({ a: 1, b: 2 }, { a: 1 });
    expect(r.summary.removed).toBe(1);
    expect(r.operations[0]).toMatchObject({ op: 'remove', path: '/b', oldValue: 2 });
  });

  it('detects replaced values', () => {
    const r = diff({ a: 1 }, { a: 99 });
    expect(r.summary.replaced).toBe(1);
    expect(r.operations[0]).toMatchObject({ op: 'replace', path: '/a', value: 99, oldValue: 1 });
  });

  it('recurses into nested objects', () => {
    const r = diff({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(r.operations[0].path).toBe('/a/b/c');
  });

  it('returns RFC 6901 JSON Pointer paths', () => {
    const r = diff({ 'a/b': 1 }, { 'a/b': 2 });
    expect(r.operations[0].path).toBe('/a~1b');
  });

  it('handles multiple simultaneous changes', () => {
    const r = diff({ a: 1, b: 2, c: 3 }, { a: 99, d: 4 });
    expect(r.summary.replaced).toBe(1); // a
    expect(r.summary.removed).toBe(2); // b, c
    expect(r.summary.added).toBe(1); // d
  });

  it('does not mutate inputs', () => {
    const before = { a: 1 };
    const after = { a: 2 };
    diff(before, after);
    expect(before).toEqual({ a: 1 });
    expect(after).toEqual({ a: 2 });
  });
});

describe('diff — arrays (LCS)', () => {
  it('detects appended items', () => {
    const r = diff([1, 2], [1, 2, 3]);
    expect(r.summary.added).toBe(1);
  });

  it('detects removed items', () => {
    const r = diff([1, 2, 3], [1, 3]);
    expect(r.summary.removed).toBe(1);
  });

  it('handles empty → populated', () => {
    const r = diff([], [1, 2, 3]);
    expect(r.summary.added).toBe(3);
  });

  it('handles populated → empty', () => {
    const r = diff([1, 2, 3], []);
    expect(r.summary.removed).toBe(3);
  });

  it('LCS treats positional changes as remove+add', () => {
    // [1,2,3] → [1,99,3]: LCS is [1,3], 2 removed, 99 added
    const r = diff([1, 2, 3], [1, 99, 3]);
    expect(r.summary.removed).toBe(1);
    expect(r.summary.added).toBe(1);
  });
});

describe('diff — identity arrays', () => {
  it('no change when content is identical', () => {
    expect(
      diff([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }], {
        arrayIdentity: 'id',
      }).hasChanges,
    ).toBe(false);
  });

  it('detects added items by identity', () => {
    const r = diff([{ id: 1 }], [{ id: 1 }, { id: 2 }], { arrayIdentity: 'id' });
    expect(r.summary.added).toBe(1);
  });

  it('detects removed items by identity', () => {
    const r = diff([{ id: 1 }, { id: 2 }], [{ id: 1 }], { arrayIdentity: 'id' });
    expect(r.summary.removed).toBe(1);
  });

  it('detects moved items', () => {
    const r = diff([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], {
      arrayIdentity: 'id',
    });
    expect(r.summary.moved).toBe(2);
    expect(r.operations.every((op) => op.op === 'move')).toBe(true);
  });

  it('detects nested changes without move', () => {
    const r = diff([{ id: 1, value: 'old' }], [{ id: 1, value: 'new' }], {
      arrayIdentity: 'id',
    });
    expect(r.summary.replaced).toBe(1);
  });

  it('detects move + nested change as movedAndChanged', () => {
    const r = diff([{ id: 1 }, { id: 2, v: 'old' }], [{ id: 2, v: 'new' }, { id: 1 }], {
      arrayIdentity: 'id',
    });
    // id:2 moved AND changed
    expect(r.summary.movedAndChanged).toBe(1);
    // move op carries the final value
    const moveOp = r.operations.find((op): op is OpMove => op.op === 'move' && op.fromIndex === 1);
    expect(moveOp?.value).toMatchObject({ id: 2, v: 'new' });
  });

  it('nestedDiff is populated on moved+changed items', () => {
    const r = diff(
      [{ id: 1, role: 'admin' }, { id: 2, role: 'user' }],
      [{ id: 2, role: 'mod' }, { id: 1, role: 'admin' }],
      { arrayIdentity: 'id' },
    );
    const movedChanged = r.operations.find(
      (op): op is OpMove => op.op === 'move' && op.nestedDiff !== undefined,
    );
    expect(movedChanged).toBeDefined();
    expect(movedChanged!.nestedDiff!.hasChanges).toBe(true);
    // Paths are relative to the item root
    expect(movedChanged!.nestedDiff!.operations[0].path).toBe('/role');
    expect(movedChanged!.nestedDiff!.summary.replaced).toBe(1);
  });

  it('nestedDiff is undefined on moved-only items', () => {
    const r = diff(
      [{ id: 1, v: 'a' }, { id: 2, v: 'b' }],
      [{ id: 2, v: 'b' }, { id: 1, v: 'a' }],
      { arrayIdentity: 'id' },
    );
    for (const op of r.operations) {
      if (op.op === 'move') {
        expect(op.nestedDiff).toBeUndefined();
      }
    }
  });

  it('nestedDiff captures deeply nested changes', () => {
    const r = diff(
      [{ id: 1, settings: { theme: 'dark', lang: 'en' } }, { id: 2 }],
      [{ id: 2 }, { id: 1, settings: { theme: 'light', lang: 'en' } }],
      { arrayIdentity: 'id' },
    );
    const moveOp = r.operations.find(
      (op): op is OpMove => op.op === 'move' && op.nestedDiff !== undefined,
    );
    expect(moveOp).toBeDefined();
    expect(moveOp!.nestedDiff!.operations[0].path).toBe('/settings/theme');
  });

  it('nestedDiff with multiple field changes', () => {
    const r = diff(
      [{ id: 1, a: 1, b: 2, c: 3 }, { id: 2 }],
      [{ id: 2 }, { id: 1, a: 99, b: 2, d: 4 }],
      { arrayIdentity: 'id' },
    );
    const moveOp = r.operations.find(
      (op): op is OpMove => op.op === 'move' && op.nestedDiff !== undefined,
    );
    expect(moveOp).toBeDefined();
    const nested = moveOp!.nestedDiff!;
    expect(nested.summary.replaced).toBe(1); // a: 1 → 99
    expect(nested.summary.removed).toBe(1);  // c removed
    expect(nested.summary.added).toBe(1);    // d added
    expect(nested.changedPaths.has('/a')).toBe(true);
    expect(nested.changedPaths.has('/c')).toBe(true);
    expect(nested.changedPaths.has('/d')).toBe(true);
  });

  it('supports array identity key as string[]', () => {
    const r = diff([{ ns: 'a', name: 'x', v: 1 }], [{ ns: 'a', name: 'x', v: 2 }], {
      arrayIdentity: ['ns', 'name'],
    });
    expect(r.summary.replaced).toBe(1);
  });

  it('supports per-path identity config', () => {
    const r = diff(
      { users: [{ id: 1 }, { id: 2 }] },
      { users: [{ id: 2 }, { id: 1 }] },
      { arrayIdentity: { '/users': 'id' } },
    );
    expect(r.summary.moved).toBe(2);
  });
});

describe('diff — options', () => {
  it('ignores exact paths', () => {
    const r = diff({ a: 1, b: 2 }, { a: 99, b: 2 }, { ignore: ['/a'] });
    expect(r.hasChanges).toBe(false);
  });

  it('ignores wildcard paths', () => {
    const r = diff(
      { meta: { ts: 1, version: 1 } },
      { meta: { ts: 2, version: 2 } },
      { ignore: ['/meta/*'] },
    );
    expect(r.hasChanges).toBe(false);
  });

  it('stops recursion at maxDepth', () => {
    // maxDepth:2 → recurse root(0)→a(1)→b(2, stop, emit replace)
    const r = diff({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }, { maxDepth: 2 });
    expect(r.operations.some((op) => op.path === '/a/b')).toBe(true);
    expect(r.operations.some((op) => op.path === '/a/b/c')).toBe(false);
  });

  it('uses custom equality function', () => {
    const r = diff(
      { a: 1.0 },
      { a: 1.00001 },
      {
        equal: (x, y) => typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) < 0.001,
      },
    );
    expect(r.hasChanges).toBe(false);
  });

  it('detectMoves: false disables move detection', () => {
    const r = diff([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], {
      arrayIdentity: 'id',
      detectMoves: false,
    });
    expect(r.operations.some((op) => op.op === 'move')).toBe(false);
  });
});

describe('diff — summary', () => {
  it('counts all operation types correctly', () => {
    const r = diff({ a: 1, b: 2, c: 3 }, { a: 99, d: 4 });
    expect(r.summary).toMatchObject({
      replaced: 1,
      removed: 2,
      added: 1,
      moved: 0,
      movedAndChanged: 0,
    });
    expect(r.summary.total).toBe(4);
  });

  it('exposes changedPaths', () => {
    const r = diff({ a: 1 }, { a: 2, b: 3 });
    expect(r.changedPaths).toContain('/a');
    expect(r.changedPaths).toContain('/b');
  });
});
