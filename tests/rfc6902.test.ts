import { describe, expect, it } from 'vitest';
import { diff } from '../src/diff.js';
import type { RFC6902Move } from '../src/rfc6902.js';
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

  it('move → RFC move (from/to as JSON Pointers)', () => {
    const ops = toRFC6902(
      diff([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], {
        arrayIdentity: 'id',
      }),
    );
    const moveOps = ops.filter((op): op is RFC6902Move => op.op === 'move');
    expect(moveOps.length).toBeGreaterThan(0);
    // RFC 6902 move has `from` and `path` as JSON Pointers
    for (const op of moveOps) {
      expect(op).toHaveProperty('from');
      expect(op).toHaveProperty('path');
      expect(op.from).toMatch(/^\/\d+$/);
      expect(op.path).toMatch(/^\/\d+$/);
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
