import { describe, expect, it } from 'vitest';
import { diff } from '../src/diff.js';
import { toRFC6902, toRFC6902JSON } from '../src/rfc6902.js';

describe('RFC 6902 adapter', () => {
  it('add → RFC add', () => {
    const ops = toRFC6902(diff({}, { a: 1 }));
    expect(ops).toEqual([{ op: 'add', path: '/a', value: 1 }]);
  });

  it('remove → RFC remove', () => {
    const ops = toRFC6902(diff({ a: 1 }, {}));
    expect(ops).toEqual([{ op: 'remove', path: '/a' }]);
  });

  it('replace → RFC replace', () => {
    const ops = toRFC6902(diff({ a: 1 }, { a: 2 }));
    expect(ops).toEqual([{ op: 'replace', path: '/a', value: 2 }]);
  });

  it('move → decomposed into RFC remove + add', () => {
    const ops = toRFC6902(
      diff([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], {
        arrayIdentity: 'id',
      }),
    );
    // Delta moves are decomposed into remove + add for correct sequential semantics
    expect(ops.some((op) => op.op === 'move')).toBe(false);
    const removes = ops.filter((op) => op.op === 'remove');
    const adds = ops.filter((op) => op.op === 'add');
    expect(removes.length).toBeGreaterThan(0);
    expect(adds.length).toBeGreaterThan(0);
  });

  it('move decomposition: removes sorted desc, adds sorted asc', () => {
    const ops = toRFC6902(
      diff(
        [{ id: 1 }, { id: 2 }, { id: 3 }],
        [{ id: 3 }, { id: 1 }, { id: 2 }],
        { arrayIdentity: 'id' },
      ),
    );
    const removes = ops.filter((op) => op.op === 'remove');
    const adds = ops.filter((op) => op.op === 'add');

    // Removes should be in descending index order
    for (let i = 1; i < removes.length; i++) {
      const prevIdx = Number.parseInt(removes[i - 1].path.split('/').pop()!, 10);
      const currIdx = Number.parseInt(removes[i].path.split('/').pop()!, 10);
      expect(prevIdx).toBeGreaterThanOrEqual(currIdx);
    }

    // Adds should be in ascending index order
    for (let i = 1; i < adds.length; i++) {
      const prevIdx = Number.parseInt(adds[i - 1].path.split('/').pop()!, 10);
      const currIdx = Number.parseInt(adds[i].path.split('/').pop()!, 10);
      expect(prevIdx).toBeLessThanOrEqual(currIdx);
    }
  });

  it('toRFC6902JSON returns valid JSON string', () => {
    const json = toRFC6902JSON(diff({ a: 1 }, { a: 2 }));
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].op).toBe('replace');
  });

  it('no changes → empty patch', () => {
    const ops = toRFC6902(diff({ a: 1 }, { a: 1 }));
    expect(ops).toEqual([]);
  });
});
